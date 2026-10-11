import { beforeEach, describe, expect, it, vi } from 'vitest'
import d2eResultRaw from '../../docs/PLANNER_GLOBAL_D2E_RESULT.json?raw'
import d2dResultRaw from '../../docs/PLANNER_GLOBAL_D2D_RESULT.json?raw'
import d2cResultRaw from '../../docs/PLANNER_GLOBAL_D2C_RESULT.json?raw'
import d2ResultRaw from '../../docs/PLANNER_GLOBAL_D2_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import d2eDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md?raw'
import d2ebDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2EB.md?raw'
import d2fDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d2f.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d2f.mjs?raw'
import { belowPracticalBonuses, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId, TargetWeapon } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, d1ResultDigest } from './plannerGlobalD1'
import type { D2EvaluationFacts } from './plannerGlobalD2'
import { runD2EEvaluation } from './plannerGlobalD2E'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import mainSource from './plannerGlobalD2F.ts?raw'
import analysisSource from './plannerGlobalD2FAnalysis.ts?raw'
import {
  compareD2FSelection,
  d2fContextId,
  d2fDiscoveryNext,
  d2fDiscoveryOutcome,
  d2fEvaluationTask,
  d2fImprovementKind,
  d2fNewSupportAuthority,
  d2fPermutations,
  d2fProductionChangedFiles,
  d2fRegisteredConditions,
  d2fRegisteredPolicySha256,
  d2fRegisteredResources,
  d2fReverificationTask,
  d2fRungExtent,
  d2fStartAttestationBody,
  deriveD2FK3Context,
  parseD2FSpecK3Context,
  parseD2FSpecK3Reservation,
  parseD2FSpecNewSupportReservation,
  parseD2FSpecWp,
  prepareD2FContextRecord,
  projectD2FD2CResult,
  projectD2FD2EResult,
  readD2FK2ContextRecord,
  readD2FK3ContextRecord,
  runD2FDiscoveryUnit,
  runD2FEvaluation,
  runD2FReverification,
  validateD2FInputs,
  verifyD2FStartAttestation,
  D2F_BASE_MAIN,
  D2F_BUDGETS,
  D2F_CALCULATION_CONTEXT,
  D2F_EXECUTION_ENVELOPE,
  D2F_K3_RESERVATION_BODY_SHA256,
  D2F_K3_RESERVATION_DIGEST,
  D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256,
  D2F_NEW_SUPPORT_RESERVATION_DIGEST,
  D2F_REGISTERED_INPUTS,
  D2F_WP_EXPECTED,
  type D2FContextTask,
  type D2FDiscoveryTask,
  type D2FEvaluationTask,
  type D2FInputEvidence,
  type D2FReplacementTask,
  type D2FReverificationTask,
  type D2FSupportAuthority,
  type D2FValidatedInputs,
} from './plannerGlobalD2F'
import { analyzeD2FRun, classifyD2FDecision, recomputeD2FK3Context, type D2FAnalysisInput, type D2FDecisionInput, type D2FDiscoveryRow, type D2FEvaluationRow } from './plannerGlobalD2FAnalysis'
import {
  D2E_B0_EXPECTED,
  D2E_CHAINED_DOCUMENT_KEYS,
  D2E_CONTEXT_RECORDS,
  D2E_I0_EXPECTED,
  D2E_INCUMBENT_G_STORE_FILES,
  D2E_K0_RESERVATION_DIGEST,
  D2E_K2_RESERVATION_DIGEST,
  D2E_ORIGIN_DIGEST,
  d2eGStoreKey,
} from './plannerGlobalD2E'

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const codeOnly = (source: string) => source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
/** A synchronous 64-hex digest for the synthetic records (eight seeded FNV-1a 32-bit passes; collision-free for the test keys). */
const syncSha = (text: string) => Array.from({ length: 8 }, (_, seed) => {
  let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}).join('')
const lf = (text: string) => text.replace(/\r\n/g, '\n')
type Json = Record<string, unknown>

// Captures every preflight call (the fixed constraints must always be []).
const preflightSpy = vi.hoisted(() => ({ calls: [] as { fixedConstraints: unknown[]; conflictResolutions: number; replacements: number }[] }))
vi.mock('../domain/planner/replacement/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/planner/replacement/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>) => {
      preflightSpy.calls.push({ fixedConstraints: [...args[2]], conflictResolutions: args[0].conflictResolutions.length, replacements: args[1].length })
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})
beforeEach(() => { preflightSpy.calls.length = 0 })

// ---------------------------------------------------------------- the real committed inputs (V)

const D2E = JSON.parse(d2eResultRaw)
const D2D = JSON.parse(d2dResultRaw)
const D2C = JSON.parse(d2cResultRaw)
/** The chained Export SHA-256 (never written in a Research source). */
const EXPORT_SHA = D2E.sources.export.sha256 as string
const SPEC = lf(d2fDocument)
const D2E_SPEC = lf(d2eDocument)
const TABLE = parseD2FSpecK3Context(SPEC)!

/**
 * The real committed RESULTs and documents plus G store / CTX record / Export stand-ins rebuilt from them (their ids, Targets and
 * reservation bodies). The stand-in support bodies and the D2-E-A text hash (through `shaMap`) to the registered SHA-256.
 */
function realEvidence(): D2FInputEvidence & { shaMap: Map<string, string> } {
  const shaMap = new Map<string, string>()
  const files = Object.fromEntries(Object.entries(D2F_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])) as D2FInputEvidence['files']
  const documents = Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: D2E.sources.documents[k].bytes, sha256: D2E.sources.documents[k].sha256 }]))
  const conds = D2D.conditions as { fixedCandidates: Json[]; t05Candidates: Json[]; t07Candidates: Json[] }
  const rows = [...conds.fixedCandidates, ...conds.t05Candidates, ...conds.t07Candidates]
  const gStoreFiles = Object.fromEntries(D2E_INCUMBENT_G_STORE_FILES.map(f => {
    const row = rows.find(r => r.label === f.label && r.ordinal === f.ordinal && r.origin === f.origin)!
    return [d2eGStoreKey(f.label, f.ordinal), { file: { bytes: f.bytes, sha256: f.sha256 }, json: { id: row.generatedBuildListEntryId, targetWeaponId: row.targetWeaponId } }]
  }))
  const contextRecords = Object.fromEntries(D2E_CONTEXT_RECORDS.map(c => {
    const row = (D2C.contexts as Json[]).find(x => x.k === c.k)!
    return [c.k, { file: { bytes: c.bytes, sha256: c.sha256 }, json: { result: { status: 'context_ready', contextId: row.contextId, supportBuildListEntryId: row.supportBuildListEntryId, supportBodySha256: row.supportBodySha256,
      reservationBody: structuredClone(row.reservationBody), reservationDigest: row.reservationDigest, originDigest: row.originDigest, excludedRouteKeys: [], excludedRouteKeySha256s: [...(row.excludedRouteKeySha256s as string[])],
      secret: 'never read' } } }]
  }))
  const ctx = D2E.context as Json
  const d2eContextRecord = { result: { status: 'context_ready', contextId: ctx.contextId, supportBuildListEntryIds: ctx.supportBuildListEntryIds, supportBodySha256s: ctx.supportBodySha256s,
    reservationBody: structuredClone(ctx.reservationBody), reservationDigest: ctx.reservationDigest, originDigest: ctx.originDigest, excludedRouteKeys: [], excludedRouteKeySha256s: ctx.excludedRouteKeySha256s,
    checks: { secret: 1 } } }
  const pool2 = (D2E.discovery.pool as Json[]).find(p => p.ordinal === 2)!
  const d2eWpGeneratedEntry = { id: pool2.generatedBuildListEntryId, targetWeaponId: ctx.targetWeaponId }
  // Export stand-ins: the K3 supports with their §3.2 Targets (hashing to the §3.2 supportBodySha256), the other D2-C supports outside.
  const k3Bodies = TABLE.supportBuildListEntryIds.map((id, i) => { const body = { id, targetWeaponId: TABLE.supportTargetWeaponIds[i] }; shaMap.set(stableStringify(body), TABLE.supportBodySha256s[i]!); return body })
  const others = [...new Set((D2C.contexts as Json[]).map(c => c.supportBuildListEntryId as string))].filter(id => !TABLE.supportBuildListEntryIds.includes(id)).map((id, i) => ({ id, targetWeaponId: `target.outside.${i}` }))
  shaMap.set(D2E_SPEC, D2F_REGISTERED_INPUTS.d2eSpecDocument.sha256)
  const k3 = parseD2FSpecK3Reservation(SPEC)!, single = parseD2FSpecNewSupportReservation(SPEC)!
  shaMap.set(stableStringify(k3), D2F_K3_RESERVATION_BODY_SHA256)
  shaMap.set(stableStringify(single), D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256)
  return { files, documents, gStoreFiles, contextRecords, d2eContextRecord, d2eWpGeneratedEntry, d2eResult: JSON.parse(d2eResultRaw), d2dResult: JSON.parse(d2dResultRaw), d2cResult: JSON.parse(d2cResultRaw),
    d2Result: JSON.parse(d2ResultRaw), phase2c2Result: JSON.parse(phase2c2ResultRaw), exportBuildListEntries: [...k3Bodies, ...others], specMarkdown: SPEC, d2eSpecMarkdown: D2E_SPEC,
    sha256OfText: text => shaMap.get(text) ?? syncSha(text), shaMap }
}

describe('D2-F registered conditions', () => {
  it('registers the committed inputs by their SHA-256 and every value the D2-F document names', async () => {
    expect(await sha256(d2eResultRaw)).toBe(D2F_REGISTERED_INPUTS.d2eResult.sha256)
    expect(await sha256(d2dResultRaw)).toBe(D2F_REGISTERED_INPUTS.d2dResult.sha256)
    expect(await sha256(d2cResultRaw)).toBe(D2F_REGISTERED_INPUTS.d2cResult.sha256)
    expect(await sha256(d2ResultRaw)).toBe(D2F_REGISTERED_INPUTS.d2Result.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D2F_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(D2E_SPEC)).toBe(D2F_REGISTERED_INPUTS.d2eSpecDocument.sha256)
    expect(await sha256(lf(d2ebDocument))).toBe(D2F_REGISTERED_INPUTS.d2ebDocument.sha256)
    for (const v of Object.values(D2F_REGISTERED_INPUTS)) expect(v.namedBy === 'd2f' ? SPEC : D2E_SPEC).toContain((v.sha256 ?? EXPORT_SHA).slice(0, 8))
    expect(D2F_REGISTERED_INPUTS.export.sha256).toBeNull()
    for (const d of [D2F_K3_RESERVATION_DIGEST, D2F_NEW_SUPPORT_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_K2_RESERVATION_DIGEST, D2F_WP_EXPECTED.inputDigest, D2F_WP_EXPECTED.resultDigest,
      D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest, D2E_B0_EXPECTED.inputDigest, D2E_B0_EXPECTED.resultDigest, D2F_K3_RESERVATION_BODY_SHA256, D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256]) expect(SPEC).toContain(d)
    expect(D2F_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
    // §1.6: the registered bodies hash to the registered digests and their stableStringify() to the registered SHA-256 (real SHA-256).
    const k3 = parseD2FSpecK3Reservation(SPEC)!, single = parseD2FSpecNewSupportReservation(SPEC)!
    expect(hashStableValue(k3)).toBe(D2F_K3_RESERVATION_DIGEST)
    expect(hashStableValue(single)).toBe(D2F_NEW_SUPPORT_RESERVATION_DIGEST)
    expect(await sha256(stableStringify(k3))).toBe(D2F_K3_RESERVATION_BODY_SHA256)
    expect(await sha256(stableStringify(single))).toBe(D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256)
    expect(k3).toMatchObject({ skill: { blocked: [341, 343, 648] }, gogma: { blocked: [67, 71, 77, 125] } })
    expect((k3.skill as Json).held).toHaveLength(308)
    expect((k3.gogma as Json).held).toHaveLength(71)
  })

  it('fixes the budgets, the envelope, the ladder and the order as D2-F-A registers them', () => {
    expect(D2F_BUDGETS).toEqual({ contexts: 1, supportPerContext: 3, contextChildren: 1, discoveryUnitsMax: 3, k3PoolCap: 2, uniqueCandidatesMax: 2, deliveriesPerUnitMax: 11, generatedEntryFilesMax: 2,
      rvChildren: 1, b0Evaluations: 1, i0Evaluations: 1, wpEvaluations: 1, admissionEvaluationsMax: 2, extensionEvaluationsMax: 2, evaluationRequestsMax: 7, childProcessesMax: 12, evaluationFullRunCap: 8,
      fullPlannerRunsMax: 56, researchMaxPlanSteps: 20_000 })
    expect(D2F_EXECUTION_ENVELOPE).toEqual({ rvBudgetMs: 600_000, contextUnitBudgetMs: 600_000, discoveryUnitBudgetMs: 3_600_000, evaluationBudgetMs: 1_800_000, discoveryEnvelopeMs: 18_000_000,
      runBudgetMs: 28_800_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none', memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D2F_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(SPEC).toMatch(/評価リクエスト合計 \| B0 1 \+ I0 1 \+ WP 1 \+ ADM ≤ 2 \+ EXT ≤ 2 = \*\*7以下\*\*/)
    expect(SPEC).toMatch(/child process合計 \| RV 1 \+ CTX 1 \+ DSC ≤ 3 \+ 評価 ≤ 7 = \*\*12以下\*\*/)
    const c = d2fRegisteredConditions()
    expect(c.ladder).toEqual([{ id: 'L0', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 } }, { id: 'L1', extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 } },
      { id: 'L2', extent: { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } }])
    expect(c.order).toEqual(['V', 'RV', 'B0', 'I0', 'WP', 'CTX-K3', 'DSC L0 -> L1 -> L2', 'ADM (discovery ordinal)', 'EXT (discovery ordinal, admitted only)'])
    expect(c.selectionOrder).toEqual(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
    expect(c.decisionRule.map(r => r.split(':')[0])).toEqual(['D2F_INVALID', 'D2F_INCOMPLETE', 'D2F_GLOBAL_COMPLETE_R', 'D2F_EXCEEDS_D2D_BEST', 'D2F_SET_COEXISTENT_NOT_BETTER', 'D2F_NO_SET_COEXISTENCE',
      'D2F_NO_ADMITTED_K3_CANDIDATE', 'D2F_NO_K3_CANDIDATE'])
    expect(c.k3PoolCap).toBe(2)
    expect(c.deliveryCapPerUnit).toBe(11)
    expect(c.dedupRules.map(r => r.slice(0, 3))).toEqual(['D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6'])
    expect(c.contextChecks.map(r => r.slice(0, 2))).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'])
    expect(c.wpExpected).toEqual({ ...D2F_WP_EXPECTED })
    expect(d2fRegisteredPolicySha256(syncSha)).toBe(d2fRegisteredPolicySha256(syncSha))
  })

  it('reads only the allowlisted D2-E / D2-C RESULT and CTX-K2 record fields', () => {
    const e = projectD2FD2EResult(JSON.parse(d2eResultRaw))!
    expect(e.evaluations.map(x => x.evaluationId)).toEqual(['I0', 'EXT-K2-t03-c1', 'EXT-K2-t03-c2'])
    expect(JSON.stringify(e)).not.toMatch(/routeCommitment|supportChecksByEntry|bodyExpected|reservationBody|candidateStableKey|d2cT03ResourcesObserved/)
    expect(e.discovery.pool.map(p => p.ordinal)).toEqual([1, 2])
    const c = projectD2FD2CResult(JSON.parse(d2cResultRaw), 't03')!
    expect(c.pool).toHaveLength(4)
    expect(Object.keys(c).sort()).toEqual(['contexts', 'decisionCase', 'invalidReasons', 'pool', 'prior', 'provenance', 'sources'])
    expect(JSON.stringify(c.contexts)).not.toMatch(/reservationBody|checks/)
    expect(JSON.stringify(c)).not.toMatch(/stepOutcome|crossSupport|winnerBuildListEntryId/)
    expect(projectD2FD2CResult(JSON.parse(d2cResultRaw), null)!.pool).toBeNull()
    const k2 = readD2FK2ContextRecord({ result: { status: 'context_ready', contextId: 'c', supportBuildListEntryIds: ['a'], supportBodySha256s: { a: 'b' }, reservationBody: { x: 1 }, reservationDigest: 'd', originDigest: 'o',
      excludedRouteKeys: [], excludedRouteKeySha256s: [], checks: { secret: 1 } } })
    expect(Object.keys(k2.record!).sort()).toEqual(['contextId', 'excludedRouteKeySha256s', 'originDigest', 'reservationBody', 'reservationDigest', 'status', 'supportBodySha256s', 'supportBuildListEntryIds'])
    expect(readD2FK2ContextRecord({ result: { status: 'context_ready', reservationBody: '{}', reservationDigest: 'd', supportBodySha256s: {}, originDigest: 'o', excludedRouteKeys: [], checks: {} } }).issue).toMatch(/not a JSON object/)
    expect(readD2FK3ContextRecord({ result: { status: 'context_ready', reservationBody: {}, reservationDigest: 'd', supportBodySha256s: {}, originDigest: 'o', excludedRouteKeys: [], checks: {},
      singleSupportReservations: { s: { reservationBody: '{}', reservationDigest: 'x' } } } }).issue).toMatch(/singleSupportReservations\[s\].reservationBody is not a JSON object/)
  })
})

// ---------------------------------------------------------------- V, the §3.1 K3 derivation, the §8.1 I0 and §8.2 WP derivations

describe('D2-F V: the K3 context, the I0 set and the WP set re-derived from the RESULTs (§3 / §8 / §11.1)', () => {
  it('derives exactly the §3.2 K3 context, the I0 set (fnv1a32:6493291d) and the WP set (fnv1a32:2f7009bf)', () => {
    const v = validateD2FInputs(realEvidence())
    expect(v.issues).toEqual([])
    expect(v.passed).toBe(true)
    expect(v.k3).toMatchObject({ contextId: TABLE.contextId, label: 't03', targetWeaponId: TABLE.targetWeaponId, currentBuildListEntryId: TABLE.currentBuildListEntryId,
      supportBuildListEntryIds: TABLE.supportBuildListEntryIds, extendedEvaluationId: TABLE.extendedEvaluationId })
    expect(v.k3!.contextId).toBe(d2fContextId('t03', TABLE.supportBuildListEntryIds))
    expect(v.k3!.addedSupportBuildListEntryId.endsWith(TABLE.newSupportSuffix)).toBe(true)
    expect(v.k3!.k2SupportBuildListEntryIds).toEqual((D2E.context as Json).supportBuildListEntryIds)
    expect(v.k3!.k1Contexts.map(c => c.k)).toEqual([3, 4])
    expect(v.k3!.lostTargetWeaponIds).toEqual([v.newSupport!.supportTargetWeaponId])
    expect(v.i0!.inputDigest).toBe(D2E_I0_EXPECTED.inputDigest)
    expect(v.wp).toMatchObject({ evaluationId: parseD2FSpecWp(SPEC)!.evaluationId, inputDigest: D2F_WP_EXPECTED.inputDigest, extensionEvaluationId: TABLE.extendedEvaluationId })
    expect(v.wp!.k2!.requiresSupport).toEqual(v.k3!.k2SupportBuildListEntryIds)
    expect(v.supports.map(s => s.contexts.map(c => c.k))).toEqual([[6], [3, 5], [1, 4, 7]])
    expect(v.d2bK0Pool).toHaveLength(3)
    expect(v.d2cK1Pool).toHaveLength(4)
    expect(v.d2eK2Pool).toHaveLength(2)
    expect(v.resourceIdentities.k2Failure.map(r => JSON.parse(r).counterBefore).sort((a, b) => a - b)).toEqual([125, 648])
    expect(v.resourceIdentities.priorT03.map(r => JSON.parse(r).counterBefore).sort((a, b) => a - b)).toEqual([71, 341, 344])
    expect(v.priorByInputDigest[D2E_B0_EXPECTED.inputDigest]!.map(x => `${x.source}:${x.evaluationId}`).sort()).toEqual(['D2-C:B0', 'D2-D:B0', 'D2-E:B0', 'D2:B0'])
    expect(v.priorByInputDigest[D2F_WP_EXPECTED.inputDigest]!.map(x => `${x.source}:${x.evaluationId}`)).toEqual([`D2-E:${TABLE.extendedEvaluationId}`])
    expect(v.expected?.i0).toMatchObject({ completed: 24, conflicts: 19, steps: 1465, resourceConflictRejections: 19, newSupportSelected: true, newSupportTargetSelected: true })
    expect(v.expected?.wp).toMatchObject({ completed: 24, conflicts: 19, steps: 1470, r5Satisfied: true })
  })

  const failing = (mutate: (e: ReturnType<typeof realEvidence>) => void) => {
    const e = realEvidence()
    mutate(e)
    const v = validateD2FInputs(e)
    expect(v.passed).toBe(false)
    return v.issues.join(';')
  }

  it('fails closed on a missing file, a digest / byte mismatch or a changed RESULT, never substituting a value', () => {
    expect(failing(e => { e.files.d2eContextRecord = null })).toMatch(/d2eContextRecord: .* is missing/)
    expect(failing(e => { e.files.d2eResult = { bytes: 409_430, sha256: '0'.repeat(64) } })).toMatch(/d2eResult: SHA-256/)
    expect(failing(e => { e.files.d2eWpGeneratedEntry = { bytes: 1, sha256: D2F_REGISTERED_INPUTS.d2eWpGeneratedEntry.sha256 } })).toMatch(/d2eWpGeneratedEntry: 1 bytes/)
    expect(failing(e => { (e.d2eResult as Json & { decision: Json }).decision.case = 'D2E_INCOMPLETE' })).toMatch(/D2-E RESULT decision.case/)
    expect(failing(e => { ((e.d2eResult as Json).provenance as Json).measuredHead = 'c0248fc'.padEnd(40, '0') })).toMatch(/D2-E RESULT measuredHead/)
    expect(failing(e => { e.d2eSpecMarkdown = `${e.d2eSpecMarkdown} ` })).toMatch(/the D2-E-A text is not the registered D2-E-A document/)
    expect(failing(e => { e.gStoreFiles['t07-c3'] = null })).toMatch(/t07-c3.generated-entry.json: the G store file is missing/)
    expect(failing(e => { const r = (e.d2eContextRecord as { result: Json }).result; r.reservationBody = stableStringify(r.reservationBody) })).toMatch(/CTX-K2: .*not a JSON object/)
    expect(failing(e => { e.d2eWpGeneratedEntry = { id: 'build-list.other', targetWeaponId: 'x' } })).toMatch(/the WP G store body is not the derived K2 G/)
  })

  it('fails closed when the §3.1 derivation is not the §3.2 table (E*, lost, X, supports, order)', () => {
    // The registered support changed in the attested text.
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| support（Entry ID昇順） | `build-list.fnv1a32-54dd2b4e`', '| support（Entry ID昇順） | `build-list.fnv1a32-54dd2b4f`') }))
      .toMatch(/the §3.1 derivation is not the §3.2 table/)
    // |E*| != 1: another EXT also completed t03 without net gain with R5.
    expect(failing(e => {
      const x = ((e.d2eResult as Json).evaluations as Json[]).find(ev => ev.evaluationId === 'EXT-K2-t03-c1')!
      Object.assign(x, { eligible: true, r5: { ...(x.r5 as Json), satisfied: true } }); ((x.extension as Json).t03Completion as Json).t03CompletedWithoutNetGain = true
    })).toMatch(/\|E\*\| = 2, not 1/)
    // |X| != 1: the I0 also selected the second outside-set participant (b4b4c72c), which then is a candidate of X too.
    expect(failing(e => {
      const evs = (e.d2eResult as Json).evaluations as Json[]
      const i0 = evs.find(ev => ev.evaluationId === 'I0')!
      const second = 'build-list.fnv1a32-b4b4c72c'
      ;(i0.plan as Json).selectedBuildListEntryIds = [...((i0.plan as Json).selectedBuildListEntryIds as string[]), second]
      e.exportBuildListEntries = [...e.exportBuildListEntries, { id: second, targetWeaponId: (evs.find(ev => ev.evaluationId === TABLE.extendedEvaluationId)!.referenceDiff as Json & { targetsLost: string[] }).targetsLost[0] }]
    })).toMatch(/\|X\| = 2, not 1/)
    // A K3 support body that does not hash to the §3.2 supportBodySha256.
    expect(failing(e => { e.shaMap.clear(); e.shaMap.set(e.d2eSpecMarkdown, D2F_REGISTERED_INPUTS.d2eSpecDocument.sha256) })).toMatch(/is not the §3.2 registered supportBodySha256/)
    // The §8.2 WP table changed.
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| 評価ID | `WP-D2E-EXT-c2` |', '| 評価ID | `WP-D2E-EXT-c1` |') })).toMatch(/the §8.2 WP derivation is not the §8.2 table/)
  })

  it('derives X mechanically: the outside-set participant not selected in I0 (b4b4c72c) is never X, without naming it', () => {
    const e = realEvidence()
    const d2e = projectD2FD2EResult(e.d2eResult)!
    const d2c = projectD2FD2CResult(e.d2cResult, 't03')!
    const targets = (JSON.parse(d2ResultRaw).discovery.targets as Json[]).map(t => ({ label: String(t.label), targetWeaponId: String(t.targetWeaponId), currentBuildListEntryId: String(t.currentBuildListEntryId) }))
    const d = deriveD2FK3Context(d2e, e.exportBuildListEntries, targets, d2c.contexts)
    expect(d.issues).toEqual([])
    expect(d.added).toEqual([TABLE.supportBuildListEntryIds.find(id => id.endsWith(TABLE.newSupportSuffix))])
    const outside = d2e.evaluations.find(x => x.evaluationId === TABLE.extendedEvaluationId)!.conflictsWithT03G.flatMap(c => c.others.filter(o => o.role === 'outside_set').map(o => o.buildListEntryId))
    expect(new Set(outside).size).toBe(2)
    // Without the D2-E context the derivation stops (fail closed).
    expect(deriveD2FK3Context({ ...d2e, context: null }, e.exportBuildListEntries, targets, d2c.contexts).k3).toBeNull()
  })
})

// ---------------------------------------------------------------- CTX-K3, DSC and the evaluation child on the Fake RNG Engine fixture

const TARGET_A = 'target.d2f.a', TARGET_B = 'target.d2f.b', TARGET_C = 'target.d2f.c', TARGET_D = 'target.d2f.d'
const ENTRY_A = 'build-list.d2f.a' as BuildListEntryId, ENTRY_B = 'build-list.d2f.b' as BuildListEntryId, ENTRY_C = 'build-list.d2f.c' as BuildListEntryId, ENTRY_D = 'build-list.d2f.d' as BuildListEntryId
const SOURCE_C = 'owned.d2f.c', SOURCE_D = 'owned.d2f.d'
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source', SKILL_C = 'series_skill.fixture.s9', SKILL_D = 'series_skill.fixture.s10'

/** Support A resets Gogma 10, support C resets Skills at 9, support D (the new one) resets Skills at 10, Target B mixes Reset Bonuses 10 + Reset Skills 7. */
function fixture(): OrchestrationScenario {
  const skill = { seriesSkillId: SKILL_A, groupSkillId: null, matchMode: 'all' as const }
  const skillC = { seriesSkillId: SKILL_C, groupSkillId: null, matchMode: 'all' as const }
  const skillD = { seriesSkillId: SKILL_D, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const c: TargetWeapon = orchestrationTarget(TARGET_C, { priority: 4, idealSkillCondition: skillC, practicalSkillCondition: skillC })
  const d: TargetWeapon = orchestrationTarget(TARGET_D, { priority: 3, idealSkillCondition: skillD, practicalSkillCondition: skillD })
  const ownedWeapons = [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }), orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B }),
    orchestrationSource(SOURCE_C, { restorationBonuses: idealBonuses(), seriesSkillId: SKILL_B }), orchestrationSource(SOURCE_D, { restorationBonuses: idealBonuses(), seriesSkillId: SKILL_B })]
  const entries = [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    orchestrationEntry(ENTRY_C, c, resetSkillsRoute(SOURCE_C, 9), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_C }),
    orchestrationEntry(ENTRY_D, d, resetSkillsRoute(SOURCE_D, 10), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_D })]
  return orchestrationScenario({ targets: [a, b, c, d], ownedWeapons, entries, engine: { gogmaPositions: 260, skillPositions: 12 } })
}
const research = (built: OrchestrationScenario) => ({ ...built.input, options: { maxPlanSteps: 20_000 } })
const E1 = [TARGET_B, ...Array.from({ length: 10 }, (_, i) => `target.e1.${i}`)]
const E1_O = [ENTRY_B, ...Array.from({ length: 10 }, (_, i) => `build-list.e1.${i}`)]
const S2 = [ENTRY_A, ENTRY_C].sort()
const S = [ENTRY_A, ENTRY_C, ENTRY_D].sort()
const body = (built: OrchestrationScenario, id: string) => research(built).buildListEntries.find(e => e.id === id)!
const derive = (built: OrchestrationScenario, ids: readonly string[]) => derivePlannerAlternativeReservation(ids.map(id => body(built, id)), built.dependencies.rngEngine)

function k1Ref(built: OrchestrationScenario, support: string, k: number) {
  const input = research(built)
  const reservation = derive(built, [support])
  const schedule = derivePhase2C26B2C1Schedule(input, built.dependencies)
  const own = input.buildListEntries.find(e => e.id === ENTRY_B)!
  return { supportBuildListEntryId: support, k, contextId: `K1-${k}`, recordSha256: `r${k}`, reservationBody: structuredClone(reservation) as unknown as Json, reservationDigest: hashStableValue(reservation),
    originDigest: schedule.snapshot.originDigest, excludedRouteKeySha256s: [syncSha(candidateStableKey(own.candidateSnapshot))], supportBodySha256: syncSha(stableStringify(body(built, support))) }
}
function contextTask(built: OrchestrationScenario, over: Partial<D2FContextTask> = {}): D2FContextTask {
  const k3 = derive(built, S), single = derive(built, [ENTRY_D]), k2 = derive(built, S2)
  const k1 = [k1Ref(built, ENTRY_A, 3), k1Ref(built, ENTRY_C, 4)]
  return { unitId: 'CTX-K3', contextId: d2fContextId('t03', S), label: 't03', targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, supportBuildListEntryIds: S, newSupportBuildListEntryId: ENTRY_D,
    e1TargetWeaponIds: E1, e1CurrentBuildListEntryIds: E1_O, registeredReservationDigest: hashStableValue(k3), registeredReservationBody: structuredClone(k3) as unknown as Json,
    registeredNewSupportReservationDigest: hashStableValue(single), registeredNewSupportReservationBody: structuredClone(single) as unknown as Json, k1Contexts: k1,
    k1SupportRecords: [...k1, { ...k1Ref(built, ENTRY_C, 7) }], k2Context: { recordSha256: 'k2', reservationBody: structuredClone(k2) as unknown as Json, reservationDigest: hashStableValue(k2),
      originDigest: k1[0]!.originDigest, excludedRouteKeySha256s: k1[0]!.excludedRouteKeySha256s }, registeredResourceIdentities: ['{"counterBefore":10,"counterStream":"gogma","kind":"same_gogma_counter"}',
      '{"counterBefore":7,"counterStream":"skill","kind":"same_skill_counter"}'], researchMaxPlanSteps: 20_000, ...over }
}
function contextOf(built: OrchestrationScenario, task = contextTask(built)) {
  const input = research(built)
  return JSON.parse(JSON.stringify(prepareD2FContextRecord(input, derivePhase2C26B2C1Schedule(input, built.dependencies), input.buildListEntries, task, built.dependencies, syncSha)))
}
function discoveryTask(built: OrchestrationScenario, ctx: Json, over: Partial<D2FDiscoveryTask> = {}): D2FDiscoveryTask {
  const k2 = derive(built, S2)
  const singles = ctx.singleSupportReservations as Record<string, { reservationBody: Json }>
  return { unitId: 'DSC-K3-L0', contextId: d2fContextId('t03', S), label: 't03', targetWeaponId: TARGET_B, supportBuildListEntryIds: S, currentBuildListEntryId: ENTRY_B, rung: 'L0', extent: d2fRungExtent('L0'),
    context: { recordSha256: 'r', reservationBody: ctx.reservationBody as Json, reservationDigest: ctx.reservationDigest as string, originDigest: ctx.originDigest as string, excludedRouteKeys: ctx.excludedRouteKeys as string[] },
    k2Reservation: { reservationBody: structuredClone(k2) as unknown as Json, reservationDigest: hashStableValue(k2) },
    singleReservations: S.map(s => ({ supportBuildListEntryId: s, source: s === ENTRY_D ? 'ctx_k3_single' as const : 'k1_ctx_record' as const, k: s === ENTRY_D ? null : 3, reservationBody: singles[s]!.reservationBody })),
    poolKeysAtStart: [], d2bK0Pool: [], d2cK1Pool: [], d2eK2Pool: [], poolCap: 2, researchMaxPlanSteps: 20_000, ...over }
}

describe('D2-F CTX-K3 (§5.1): C1 .. C8 from Production parts, no Search, no full run', () => {
  it('derives the three-support reservation from the support bodies, order-invariant over the 6 orders, containing K2 / K1 / the new single', () => {
    const built = fixture()
    const ctx = contextOf(built)
    expect(ctx.issues).toEqual([])
    expect(ctx.status).toBe('context_ready')
    expect(ctx.checks.C1.satisfied && ctx.checks.C2.satisfied && ctx.checks.C3.satisfied && ctx.checks.C4.satisfied && ctx.checks.C6.satisfied && ctx.checks.C7.satisfied).toBe(true)
    expect(ctx.checks.C5).toMatchObject({ state: 'matched', digestMatched: true, bodyMatched: true })
    expect(ctx.checks.C6).toMatchObject({ k2Contained: true, newSupportContained: true })
    expect(ctx.checks.C7.permutations).toHaveLength(6)
    expect(ctx.checks.C8).toMatchObject({ state: 'matched', existingSupportsMatched: true })
    expect(ctx.supportBuildListEntryIds).toEqual(S)
    expect(Object.keys(ctx.singleSupportReservations).sort()).toEqual(S)
    expect(typeof ctx.reservationBody).toBe('object')
    expect(ctx.reservationDigest).toBe(hashStableValue(ctx.reservationBody))
    // The new support blocks Skill 10, which the K2 reservation does not.
    expect((ctx.reservationBody.skill as Json).blocked).toContain(10)
    expect(((derive(built, S2) as unknown as Json).skill as Json).blocked).not.toContain(10)
    expect(ctx.diagnostics.equalsK1ComponentwiseUnion).not.toBeNull()
    expect(ctx.diagnostics.registeredResources.map((r: Json) => [r.counterBefore, r.held, r.blocked])).toEqual([[10, true, true], [7, false, false]])
    expect(preflightSpy.calls).toEqual([])
    expect(readD2FK3ContextRecord({ result: ctx }).issue).toBeNull()
  })

  it('records C5 / C8 mismatched against another registered body and fails C1 / C6 / C8-existing closed', () => {
    const built = fixture()
    const empty = { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] }
    const c5 = contextOf(built, contextTask(built, { registeredReservationDigest: 'fnv1a32:00000000', registeredReservationBody: empty }))
    expect(c5.checks.C5).toMatchObject({ state: 'mismatched', digestMatched: false, bodyMatched: false })
    const c8 = contextOf(built, contextTask(built, { registeredNewSupportReservationDigest: 'fnv1a32:00000000', registeredNewSupportReservationBody: empty }))
    expect(c8.checks.C8).toMatchObject({ state: 'mismatched', existingSupportsMatched: true })
    expect(c8.status).toBe('context_ready')
    const inE1 = contextOf(built, contextTask(built, { e1TargetWeaponIds: [TARGET_B, TARGET_D, ...E1.slice(2)] }))
    expect(inE1.checks.C1.satisfied).toBe(false)
    expect(inE1.status).toBe('guardrail_violation')
    const task = contextTask(built)
    const wider = contextOf(built, { ...task, k1Contexts: task.k1Contexts.map((k, i) => i === 0 ? { ...k, reservationBody: { ...k.reservationBody, exclusiveOwnedWeaponIds: ['owned.other'] } } : k) })
    expect(wider.checks.C6.satisfied).toBe(false)
    expect(wider.status).toBe('guardrail_violation')
    const k2Wider = contextOf(built, { ...task, k2Context: { ...task.k2Context, reservationBody: { ...task.k2Context.reservationBody, exclusiveOwnedWeaponIds: ['owned.other'] } } })
    expect(k2Wider.checks.C6).toMatchObject({ satisfied: false, k2Contained: false })
    const existing = contextOf(built, { ...task, k1SupportRecords: task.k1SupportRecords.map((k, i) => i === 2 ? { ...k, reservationDigest: 'fnv1a32:00000000' } : k) })
    expect(existing.checks.C8.existingSupportsMatched).toBe(false)
    expect(existing.status).toBe('guardrail_violation')
    const twoSupports = contextOf(built, { ...task, supportBuildListEntryIds: S2, contextId: d2fContextId('t03', S2) })
    expect(twoSupports.checks.C1.satisfied).toBe(false)
  })

  it('the analyzer recomputes C3 / C5 / C7 / C8 from the three Export bodies, never from the record (a tampered record is caught)', () => {
    const built = fixture()
    const ctx = contextOf(built)
    const exportEntries = research(built).buildListEntries
    // Support A Resets Bonuses on SOURCE_A (consumed); supports C / D Reset Skills (referenced, not consumed).
    const run = (over: { record?: Json; exportBuildListEntries?: readonly unknown[]; rngEngine?: null; recordSupportBuildListEntryIds?: string[] } = {}) => recomputeD2FK3Context({
      recordSupportBuildListEntryIds: over.recordSupportBuildListEntryIds ?? ctx.supportBuildListEntryIds, registeredSupportBuildListEntryIds: S, exportBuildListEntries: over.exportBuildListEntries ?? exportEntries,
      record: (over.record ?? ctx) as never, rngEngine: over.rngEngine === null ? null : built.dependencies.rngEngine })
    const ok = run()
    expect(ok).toMatchObject({ satisfied: true, issues: [], exclusiveConsumedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A], referencedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A, SOURCE_C, SOURCE_D].sort(),
      routeUnitPlannedEntries: 3, routeUnitRejections: 0, derivedReservationDigest: ctx.reservationDigest, derivedReservationBodyMatchesRecord: true })
    expect(ok.permutations.map(p => p.order)).toEqual(d2fPermutations(S))
    expect(Object.values(ok.singles).every(s => s.recordMatched)).toBe(true)
    const tamper = (patch: (r: Json) => void) => { const r = JSON.parse(JSON.stringify(ctx)); patch(r); return run({ record: r }) }
    expect(tamper(r => { (r.checks as Json & { C3: Json }).C3.exclusiveConsumedOwnedWeaponIds = [] })).toMatchObject({ satisfied: false, recordMatched: { consumed: false } })
    expect(tamper(r => { (r.checks as Json & { C3: Json }).C3.referencedOwnedWeaponIds = [ORCHESTRATION_SOURCE_A] })).toMatchObject({ satisfied: false, recordMatched: { referenced: false } })
    // A record body that one support order does not derive (C7) and a tampered digest (C5).
    const c7 = tamper(r => { ((r.reservationBody as Json).skill as Json).blocked = [] })
    expect(c7.issues.join(';')).toMatch(/C7: the six support orders do not derive the record reservation/)
    expect(tamper(r => { r.reservationDigest = 'fnv1a32:00000000' }).issues.join(';')).toMatch(/reservationDigest is not the recomputed K3 digest/)
    // A tampered single reservation (C8).
    expect(tamper(r => { ((r.singleSupportReservations as Json)[ENTRY_D] as Json).reservationDigest = 'fnv1a32:00000000' }).issues.join(';')).toMatch(/single reservations are not the recomputed ones/)
    // Route unit planning rejects a support Route whose saved Counter does not advance as the Engine does.
    const rejected = exportEntries.map(e => e.id !== ENTRY_A ? e : { ...e, candidateSnapshot: { ...e.candidateSnapshot, route: { ...e.candidateSnapshot.route,
      operations: e.candidateSnapshot.route.operations.map(op => ({ ...op, gogmaCounterAfter: 13 })) } } })
    expect(run({ exportBuildListEntries: rejected }).issues.join(';')).toMatch(/route unit planning rejected 1 support Entry/)
    expect(run({ rngEngine: null })).toMatchObject({ satisfied: false, issues: expect.arrayContaining(['no RNG Engine to recompute the route unit plans and the reservations']) })
    expect(run({ recordSupportBuildListEntryIds: S2 }).satisfied).toBe(false)
    expect(run({ exportBuildListEntries: exportEntries.filter(e => e.id !== ENTRY_D) }).issues.join(';')).toMatch(/0 Export Entries hold/)
  })

  it('reports the registered resources held / blocked from a reservation body (diagnostic only)', () => {
    const k3 = parseD2FSpecK3Reservation(SPEC)!
    const ids = ['{"counterBefore":648,"counterStream":"skill","kind":"same_skill_counter"}', '{"counterBefore":344,"counterStream":"skill","kind":"same_skill_counter"}', 'not json']
    expect(d2fRegisteredResources(k3, ids).map(r => [r.counterBefore, r.held, r.blocked])).toEqual([[648, true, true], [344, true, false], [null, null, null]])
  })
})

describe('D2-F DSC (§5.2 - §5.6): R0-K3 / R0-K2 / R0-split, D-1 .. D-6, the rung progression', () => {
  it('pools at most two K3 Candidates that respect the K3, the K2 and all three single reservations, never materializing a known key', async () => {
    const built = fixture()
    const ctx = contextOf(built)
    const unit = await runD2FDiscoveryUnit(research(built), discoveryTask(built, ctx), built.dependencies, { sha256OfText: syncSha })
    if (unit.status === 'guardrail_violation' || unit.status === 'discovery_calculation_error') throw new Error(JSON.stringify(unit))
    expect(unit.deliveries.every(d => d.r0K3 && d.r0K2 && Object.values(d.r0Split).every(Boolean) && Object.keys(d.r0Split).length === 3)).toBe(true)
    expect(unit.pooled.length).toBeGreaterThan(0)
    expect(unit.pooled.length).toBeLessThanOrEqual(2)
    for (const p of unit.pooled) {
      expect(p.requiresSupport).toEqual(S)
      expect(p.reservationDigest).toBe(ctx.reservationDigest)
      expect(p.replacement).toEqual({ status: 'ready', replacedBuildListEntryId: ENTRY_B })
    }
    expect(preflightSpy.calls).toEqual([])
    const key = unit.pooled[0]!.candidateStableKey
    const classify = async (over: Partial<D2FDiscoveryTask>) => {
      const r = await runD2FDiscoveryUnit(research(built), discoveryTask(built, ctx, over), built.dependencies, { sha256OfText: syncSha })
      if (r.status === 'guardrail_violation' || r.status === 'discovery_calculation_error') throw new Error(JSON.stringify(r))
      return r.deliveries.find(d => d.candidateStableKey === key)
    }
    expect(await classify({ poolKeysAtStart: [key] })).toMatchObject({ action: 'duplicate_of_lower_rung' })
    expect(await classify({ d2bK0Pool: [{ ordinal: 2, keySha256: syncSha(key) }] })).toMatchObject({ action: 'same_key_as_d2b_k0_pool', matchedD2bOrdinal: 2 })
    expect(await classify({ d2cK1Pool: [{ ordinal: 3, contextId: 'K1-t03-x', keySha256: syncSha(key) }] })).toMatchObject({ action: 'same_key_as_d2c_k1_pool', matchedD2cK1: { ordinal: 3, contextId: 'K1-t03-x' } })
    expect(await classify({ d2eK2Pool: [{ ordinal: 1, keySha256: syncSha(key) }] })).toMatchObject({ action: 'same_key_as_d2e_k2_pool', matchedD2eK2Ordinal: 1, matchedD2bOrdinal: null, matchedD2cK1: null })
  })

  it('stops on context drift, a non-registered extent, a two-support set or a missing single reservation (guardrail)', async () => {
    const built = fixture()
    const ctx = contextOf(built)
    const run = (over: Partial<D2FDiscoveryTask>) => runD2FDiscoveryUnit(research(built), discoveryTask(built, ctx, over), built.dependencies, { sha256OfText: syncSha })
    expect(await run({ context: { ...discoveryTask(built, ctx).context, reservationDigest: 'fnv1a32:00000000' } })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^context_drift: /)] })
    expect(await run({ extent: d2fRungExtent('L2') })).toMatchObject({ status: 'guardrail_violation' })
    expect(await run({ singleReservations: discoveryTask(built, ctx).singleReservations.slice(0, 2) })).toMatchObject({ status: 'guardrail_violation' })
    expect(await run({ supportBuildListEntryIds: S2, contextId: d2fContextId('t03', S2) })).toMatchObject({ status: 'guardrail_violation' })
    expect(await run({ k2Reservation: { reservationBody: {}, reservationDigest: 'fnv1a32:00000000' } })).toMatchObject({ status: 'guardrail_violation' })
    // An R0-K2 reservation the K3 Candidates do not respect is an invariant violation, never a pooled Candidate.
    const blocking = { normal: [], skill: { held: [7, 8, 9, 10, 11, 12], blocked: [7, 8, 9, 10, 11, 12] }, gogma: { held: [10, 11, 12], blocked: [10, 11, 12] }, exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_B] }
    const r = await run({ k2Reservation: { reservationBody: blocking, reservationDigest: hashStableValue(blocking) } })
    expect(r.status === 'guardrail_violation' || (r.status !== 'discovery_calculation_error' && r.deliveries.length === 0)).toBe(true)
  })

  it('escalates only after an extent bound with a pool below 2, and stops on cap / exhaustion / unmeasured', () => {
    expect(d2fDiscoveryNext('stopped_by_search_extent_bound', 'L0', 0)).toEqual({ next: 'L1', stop: null })
    expect(d2fDiscoveryNext('stopped_by_search_extent_bound', 'L1', 1)).toEqual({ next: 'L2', stop: null })
    expect(d2fDiscoveryNext('ladder_exhausted', 'L2', 0)).toEqual({ next: null, stop: 'ladder_exhausted' })
    expect(d2fDiscoveryNext('discovery_cap_reached', 'L0', 2)).toEqual({ next: null, stop: 'discovery_cap_reached' })
    expect(d2fDiscoveryNext('discovery_exhausted', 'L1', 1)).toEqual({ next: null, stop: 'discovery_exhausted' })
    expect(d2fDiscoveryNext('timeout', 'L2', 0)).toEqual({ next: null, stop: 'unmeasured' })
    expect(d2fDiscoveryNext('out_of_memory', 'L2', 0)).toEqual({ next: null, stop: 'unmeasured' })
    expect(d2fDiscoveryNext('not_executed', 'L1', 0)).toEqual({ next: null, stop: 'not_executed' })
    expect(() => d2fDiscoveryNext('stopped_by_search_extent_bound', 'L1', 2)).toThrow(/full pool/)
    expect([d2fDiscoveryOutcome('discovery_cap_reached'), d2fDiscoveryOutcome('ladder_exhausted'), d2fDiscoveryOutcome('discovery_exhausted'), d2fDiscoveryOutcome('unmeasured'), d2fDiscoveryOutcome(null)])
      .toEqual(['cap_reached', 'ladder_exhausted', 'discovery_exhausted', 'unmeasured', 'unmeasured'])
  })
})

describe('D2-F evaluations (§6 / §9.2): the runD2EEvaluation() procedure with three supports, S4 / S5 per support and S6 for the K2 / K3 set', () => {
  async function pooledK3() {
    const built = fixture()
    const ctx = contextOf(built)
    const unit = await runD2FDiscoveryUnit(research(built), discoveryTask(built, ctx), built.dependencies, { sha256OfText: syncSha })
    if (unit.status !== 'discovery_cap_reached' && unit.status !== 'stopped_by_search_extent_bound' && unit.status !== 'discovery_exhausted') throw new Error(JSON.stringify(unit))
    return { built, ctx, pooled: unit.pooled }
  }
  const authorities = (built: OrchestrationScenario, ctx: Json): D2FSupportAuthority[] => [
    ...[k1Ref(built, ENTRY_A, 3), k1Ref(built, ENTRY_C, 4)].map(k => ({ supportBuildListEntryId: k.supportBuildListEntryId, source: 'k1_ctx_record' as const, k: k.k, contextId: `K1-${k.k}`,
      supportBodySha256: k.supportBodySha256, reservationDigest: k.reservationDigest, reservationBody: k.reservationBody })),
    d2fNewSupportAuthority(ctx as never)!].sort((x, y) => x.supportBuildListEntryId < y.supportBuildListEntryId ? -1 : 1)
  const k3Task = (built: OrchestrationScenario, ctx: Json, g: BuildListEntry, stage: 'ADM' | 'EXT', over: Partial<D2FReplacementTask> = {}): D2FEvaluationTask => ({
    evaluationId: `${stage}-K3-t03-c1`, stage, evaluatedAgainst: stage === 'ADM' ? 'baseline' : 'replacement_set', ordinal: 1, researchMaxPlanSteps: 20_000, fullRunCap: 8, supportAuthorities: authorities(built, ctx),
    replacements: [{ targetIndex: 3, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: g.id, generatedEntrySha256: 'f'.repeat(64), generatedEntryFile: 'g.json',
      requiresSupport: S, contextId: d2fContextId('t03', S), contextReservationDigest: ctx.reservationDigest as string, contextReservation: ctx.reservationBody as Json,
      searchReservationDigest: ctx.reservationDigest as string, ...over }] })

  it('admits a K3 Candidate with found_R on S (3), S4 / S5 against the authorities (the new support from CTX-K3) and S6 on the set, with no fixed constraint', async () => {
    const { built, ctx, pooled } = await pooledK3()
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const adm = await runD2FEvaluation(input, input.buildListEntries, k3Task(built, ctx, g, 'ADM'), [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    if (adm.status !== 'evaluated') throw new Error(JSON.stringify(adm))
    expect(adm.trialVerdict).not.toBeNull()
    expect(adm.childRecheck).toEqual({ checked: 1, issues: [] })
    expect(Object.keys(adm.supportStaticChecks).sort()).toEqual(S)
    expect(Object.values(adm.supportStaticChecks).every(c => c.S4 && c.S5.satisfied)).toBe(true)
    expect(adm.replacementReservationChecks[g.id]).toMatchObject({ kind: 'k3_set', digestMatched: true, bodyMatched: true, searchInputDigestMatched: true, satisfied: true })
    expect(Object.keys(adm.supportChecks).sort()).toEqual(S)
    expect(adm.runConflictResolutions).toBe(0)
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    expect(adm.resultDigest).toBe(d1ResultDigest(adm))
  })

  it('stops before the full run on S6 / S5 / S4 failures, a missing authority, a wrong stage shape or a G store mismatch (guardrail)', async () => {
    const { built, ctx, pooled } = await pooledK3()
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const run = (task: D2FEvaluationTask, sha = 'f'.repeat(64)) => runD2FEvaluation(input, input.buildListEntries, task, [g], [sha], built.dependencies, { sha256OfText: syncSha })
    expect(await run(k3Task(built, ctx, g, 'ADM', { searchReservationDigest: 'fnv1a32:00000000' }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S6: support_set_reservation_mismatch/)] })
    expect(await run(k3Task(built, ctx, g, 'ADM', { contextReservation: { ...(ctx.reservationBody as Json), exclusiveOwnedWeaponIds: [] } }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S6: /)] })
    const badNew = { ...k3Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built, ctx).map(a => a.source === 'ctx_k3_single' ? { ...a, reservationDigest: 'fnv1a32:00000000' } : a) }
    expect(await run(badNew)).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S5: /)] })
    const badBody = { ...k3Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built, ctx).map((a, i) => i === 1 ? { ...a, supportBodySha256: '0'.repeat(64) } : a) }
    expect(await run(badBody)).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S4: /)] })
    expect(await run({ ...k3Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built, ctx).filter(a => a.source !== 'ctx_k3_single') })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/no S5 authority/)] })
    expect(await run(k3Task(built, ctx, g, 'ADM'), '0'.repeat(64))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV1′: /)] })
    expect(await run(k3Task(built, ctx, g, 'ADM', { currentBuildListEntryId: ENTRY_A }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV2′: /)] })
    expect(await run({ ...k3Task(built, ctx, g, 'ADM'), ordinal: null })).toMatchObject({ status: 'guardrail_violation' })
    // Shapes: an ADM with a K2 Candidate, a WP with a K3 Candidate, a replacement with four supports.
    expect(await run(k3Task(built, ctx, g, 'ADM', { requiresSupport: S2, contextReservation: structuredClone(derive(built, S2)) as unknown as Json, contextReservationDigest: hashStableValue(derive(built, S2)),
      searchReservationDigest: hashStableValue(derive(built, S2)) }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/exactly one K3 Candidate/)] })
    expect(await run({ ...k3Task(built, ctx, g, 'ADM'), stage: 'WP', evaluatedAgainst: 'replacement_set', ordinal: null })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/exactly one K2 Candidate/)] })
    expect(await run(k3Task(built, ctx, g, 'ADM', { requiresSupport: [...S, 'build-list.d2f.e'].sort() }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/more than three support Entries/)] })
    expect(preflightSpy.calls).toEqual([])
  })

  it('is the runD2EEvaluation() procedure for a K0 / K1 / K2 set: the same facts, inputDigest and resultDigest (B0, I0 and the WP K2 path)', async () => {
    const { built, pooled } = await pooledK3()
    const input = research(built)
    const g = pooled[0]!.generatedEntry!
    const strip = (x: Json) => Object.fromEntries(Object.entries(x).filter(([k]) => !['replacementReservationChecks', 'childRecheck', 'supportBodySha256Observed'].includes(k)))
    // B0
    const b0f = await runD2FEvaluation(input, input.buildListEntries, { evaluationId: 'B0', stage: 'B0', evaluatedAgainst: 'baseline_reference', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8, supportAuthorities: [],
      replacements: [] }, [], [], built.dependencies, { sha256OfText: syncSha })
    const b0e = await runD2EEvaluation(input, input.buildListEntries, { evaluationId: 'B0', stage: 'B0', evaluatedAgainst: 'baseline_reference', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8, supportAuthorities: [],
      replacements: [] }, [], [], built.dependencies, { sha256OfText: syncSha })
    if (b0f.status !== 'evaluated' || b0e.status !== 'evaluated') throw new Error(JSON.stringify([b0f.status, b0e.status]))
    expect(strip(b0f as unknown as Json)).toEqual(strip(b0e as unknown as Json))
    // I0-shaped K1 replacement of Target B with support A.
    const a = k1Ref(built, ENTRY_A, 3)
    const k1 = { targetIndex: 3, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: g.id, generatedEntrySha256: 'f'.repeat(64), generatedEntryFile: 'g.json', requiresSupport: [ENTRY_A],
      contextId: 'K1-t03-a', contextReservationDigest: a.reservationDigest, contextReservation: a.reservationBody, searchReservationDigest: null }
    const auth = { supportBuildListEntryId: ENTRY_A, k: 3, contextId: 'K1-3', supportBodySha256: a.supportBodySha256, reservationDigest: a.reservationDigest, reservationBody: a.reservationBody }
    const i0f = await runD2FEvaluation(input, input.buildListEntries, { evaluationId: 'I0', stage: 'I0', evaluatedAgainst: 'replacement_set', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8,
      supportAuthorities: [{ ...auth, source: 'k1_ctx_record' }], replacements: [k1] }, [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    const i0e = await runD2EEvaluation(input, input.buildListEntries, { evaluationId: 'I0', stage: 'I0', evaluatedAgainst: 'replacement_set', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8,
      supportAuthorities: [auth], replacements: [k1] }, [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    if (i0f.status !== 'evaluated' || i0e.status !== 'evaluated') throw new Error(JSON.stringify([i0f.status, i0e.status]))
    expect(strip(i0f as unknown as Json)).toEqual(strip(i0e as unknown as Json))
    expect(i0f.replacementReservationChecks).toEqual(i0e.replacementReservationChecks)
    // The K2 path: D2-F WP vs D2-E EXT over the same K2 replacement (supports A, C).
    const k2 = derive(built, S2)
    const c = k1Ref(built, ENTRY_C, 4)
    const k2Rep = { ...k1, requiresSupport: S2, contextId: 'K2-t03', contextReservationDigest: hashStableValue(k2), contextReservation: structuredClone(k2) as unknown as Json, searchReservationDigest: hashStableValue(k2) }
    const auths = [auth, { supportBuildListEntryId: ENTRY_C, k: 4, contextId: 'K1-4', supportBodySha256: c.supportBodySha256, reservationDigest: c.reservationDigest, reservationBody: c.reservationBody }]
    const wpf = await runD2FEvaluation(input, input.buildListEntries, { evaluationId: 'WP', stage: 'WP', evaluatedAgainst: 'replacement_set', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8,
      supportAuthorities: auths.map(x => ({ ...x, source: 'k1_ctx_record' as const })), replacements: [k2Rep] }, [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    const exte = await runD2EEvaluation(input, input.buildListEntries, { evaluationId: 'EXT', stage: 'EXT', evaluatedAgainst: 'replacement_set', ordinal: 1, researchMaxPlanSteps: 20_000, fullRunCap: 8,
      supportAuthorities: auths, replacements: [k2Rep] }, [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    if (wpf.status !== 'evaluated' || exte.status !== 'evaluated') throw new Error(JSON.stringify([wpf, exte]))
    expect(strip(wpf as unknown as Json)).toEqual(strip(exte as unknown as Json))
    expect(wpf.resultDigest).toBe(exte.resultDigest)
    expect(wpf.replacementReservationChecks).toEqual(exte.replacementReservationChecks)
    expect(d1InputDigest([TARGET_B], [g.id], ['f'.repeat(64)], 'e')).toBe(d1InputDigest([TARGET_B], [g.id], ['f'.repeat(64)], 'e'))
  })
})

describe('D2-F RV (§9.1): RV1 .. RV6 (the unchanged D2-D RV), RV7 (the new support), RV8 (the WP K2 Candidate)', () => {
  it('re-verifies the new support body / single reservation and the WP K2 G store body, replacement and R0, failing closed on drift', async () => {
    const built = fixture()
    const ctx = contextOf(built)
    const unit = await runD2FDiscoveryUnit(research(built), discoveryTask(built, ctx), built.dependencies, { sha256OfText: syncSha })
    if (unit.status !== 'discovery_cap_reached' && unit.status !== 'stopped_by_search_extent_bound' && unit.status !== 'discovery_exhausted') throw new Error(JSON.stringify(unit))
    const p = unit.pooled[0]!
    const g = p.generatedEntry!
    const input = research(built)
    const schedule = derivePhase2C26B2C1Schedule(input, built.dependencies)
    const single = derive(built, [ENTRY_D])
    const supports = [ENTRY_A, ENTRY_C, ENTRY_D].map(s => { const k = k1Ref(built, s, 3); return { supportBuildListEntryId: s, contexts: [{ k: 3, supportBodySha256: k.supportBodySha256, reservationDigest: k.reservationDigest, reservationBody: k.reservationBody }] } })
    const task = (over: Partial<D2FReverificationTask['wpCandidate']> = {}, ns: Partial<D2FReverificationTask['newSupport']> = {}): D2FReverificationTask => ({
      unitId: 'RV', d2d: { unitId: 'RV', candidates: [], supports, k0ReservationDigest: D2E_K0_RESERVATION_DIGEST, researchMaxPlanSteps: 20_000 },
      newSupport: { supportBuildListEntryId: ENTRY_D, supportBodySha256: syncSha(stableStringify(body(built, ENTRY_D))), registeredReservationDigest: hashStableValue(single),
        registeredReservationBody: structuredClone(single) as unknown as Json, ...ns },
      wpCandidate: { label: 't03', ordinal: 2, generatedBuildListEntryId: g.id, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedEntryFile: 'wp.json', generatedEntryBytes: 10,
        generatedEntrySha256: 'w'.repeat(64), searchIdentity: p.searchIdentity, keySha256: syncSha(p.candidateStableKey), contextReservationDigest: ctx.reservationDigest as string,
        contextReservationBody: ctx.reservationBody as Json, ...over },
      researchMaxPlanSteps: 20_000 })
    const run = async (t = task(), wp: unknown = g, observed: { bytes: number; sha256: string } | null = { bytes: 10, sha256: 'w'.repeat(64) }) =>
      runD2FReverification(input, input.buildListEntries, schedule, t, [], [], wp, observed, built.dependencies, syncSha)
    const ok = await run()
    expect(ok.newSupport.RV7).toMatchObject({ exportBodies: 1, bodyMatched: true, digestMatched: true, reservationBodyMatched: true, satisfied: true })
    expect(ok.wpCandidate.RV8).toMatchObject({ bodySha256Matched: true, idMatched: true, targetMatched: true, notStale: true, searchRunIdMatched: true, keySha256Matched: true,
      replacement: { status: 'ready', replacedBuildListEntryId: ENTRY_B, satisfied: true }, r0: { respects: true } })
    expect(ok.d2dStatus).toBe('verified')
    expect((await run(task({}, { supportBodySha256: '0'.repeat(64) }))).newSupport.RV7).toMatchObject({ bodyMatched: false, satisfied: false })
    expect((await run(task({}, { registeredReservationDigest: 'fnv1a32:00000000' }))).newSupport.RV7).toMatchObject({ digestMatched: false, satisfied: false })
    const drift = await run(task({}, { registeredReservationBody: { ...(structuredClone(single) as unknown as Json), exclusiveOwnedWeaponIds: ['owned.other'] } }))
    expect(drift).toMatchObject({ status: 'guardrail_violation', newSupport: { RV7: { reservationBodyMatched: false } } })
    expect((await run(task(), g, { bytes: 10, sha256: '0'.repeat(64) })).wpCandidate.RV8).toMatchObject({ bodySha256Matched: false, satisfied: false })
    expect((await run(task({ keySha256: '0'.repeat(64) }))).wpCandidate.RV8).toMatchObject({ keySha256Matched: false, satisfied: false })
    expect((await run(task({ currentBuildListEntryId: ENTRY_A }))).wpCandidate.RV8).toMatchObject({ replacement: { satisfied: false }, satisfied: false })
    // An R0 reservation the WP Candidate does not respect (its Route positions blocked).
    const blocking = { normal: [], skill: { held: [7, 8, 9, 10, 11, 12], blocked: [7, 8, 9, 10, 11, 12] }, gogma: { held: [10, 11, 12, 13], blocked: [10, 11, 12, 13] }, exclusiveOwnedWeaponIds: [] }
    expect((await run(task({ contextReservationBody: blocking, contextReservationDigest: hashStableValue(blocking) }))).wpCandidate.RV8).toMatchObject({ r0: { respects: false }, satisfied: false })
    expect((await run(task(), null, null))).toMatchObject({ status: 'guardrail_violation', wpCandidate: { RV8: { idMatched: false, satisfied: false } } })
    expect(preflightSpy.calls).toEqual([])
  })
})

// ---------------------------------------------------------------- judgements and the decision (§8.6 / §12.3)

describe('D2-F judgements and the decision', () => {
  it('orders eligible EXT by completed desc, Conflicts asc, steps asc, discovery ordinal asc and names the improvement kind', () => {
    const m = (ordinal: number, completed: number, conflicts: number, steps: number) => ({ evaluationId: `E${ordinal}`, ordinal, completed, conflicts, steps })
    expect([m(2, 24, 19, 1465), m(1, 25, 20, 1600), m(3, 24, 18, 1500)].sort(compareD2FSelection).map(x => x.evaluationId)).toEqual(['E1', 'E3', 'E2'])
    expect([m(2, 24, 19, 1465), m(1, 24, 19, 1470)].sort(compareD2FSelection).map(x => x.evaluationId)).toEqual(['E2', 'E1'])
    expect(d2fImprovementKind(true, { completed: 25, conflicts: 20 }, { completed: 24, conflicts: 19 })).toBe('completed_increase')
    expect(d2fImprovementKind(true, { completed: 24, conflicts: 18 }, { completed: 24, conflicts: 19 })).toBe('conflict_decrease_only')
    expect(d2fImprovementKind(false, { completed: 25, conflicts: 18 }, { completed: 24, conflicts: 19 })).toBeNull()
  })

  it('classifies the decision top to bottom and keeps discovery, the new support, R5, improved and R6 apart', () => {
    const base: D2FDecisionInput = { invalidReasons: [], unmeasured: [], discoveryOutcome: 'cap_reached', pooledCandidates: 2, admittedCandidates: 2, measuredAdmissions: 2, r5SatisfiedExtensions: [],
      eligibleExtensions: [], improvedExtensions: [], r5OnlyEligibleExtensions: [], equalMetricsExtensions: [], conflictIncreasedExtensions: [], t03SelectedExtensions: [], t03CompletedWithoutNetGainExtensions: [],
      incumbentRegressedExtensions: [], newSupportSelectedExtensions: [], newSupportTargetRetainedExtensions: [], newSupportLostExtensions: [], t03CompletedWithNewSupportRetainedWithoutNetGainExtensions: [],
      r6SatisfiedExtensions: [], measuredExtensions: ['E1', 'E2'], bestEligibleExtension: null, bestImprovedExtension: null, improvementKind: null, boundLimitedEvaluations: [], wrapperParity: 'matched',
      subject: { evaluationId: 'I0', metrics: { completed: 24, conflicts: 19, steps: 1465 } }, i0Metrics: { completed: 24, conflicts: 19, steps: 1465 } }
    expect(classifyD2FDecision({ ...base, invalidReasons: [{ category: 'wrapper_parity', detail: 'x' }], r6SatisfiedExtensions: ['E1'] }).case).toBe('D2F_INVALID')
    expect(classifyD2FDecision({ ...base, unmeasured: ['WP-D2E-EXT-c2'], wrapperParity: 'not_checked', improvedExtensions: ['E1'], r5SatisfiedExtensions: ['E1'] }))
      .toMatchObject({ case: 'D2F_INCOMPLETE', lowerBound: true, exceedsD2dObservedUnderIncomplete: true, setCoexistenceObservedUnderIncomplete: true, k3CandidateObservedUnderIncomplete: true, wrapperParity: 'not_checked' })
    expect(classifyD2FDecision({ ...base, r6SatisfiedExtensions: ['E1'], improvedExtensions: ['E1'] }).case).toBe('D2F_GLOBAL_COMPLETE_R')
    expect(classifyD2FDecision({ ...base, improvedExtensions: ['E1'], r5SatisfiedExtensions: ['E1'], improvementKind: 'conflict_decrease_only' })).toMatchObject({ case: 'D2F_EXCEEDS_D2D_BEST', improvementKind: 'conflict_decrease_only' })
    expect(classifyD2FDecision({ ...base, r5SatisfiedExtensions: ['E1'], t03CompletedWithNewSupportRetainedWithoutNetGainExtensions: ['E1'] }))
      .toMatchObject({ case: 'D2F_SET_COEXISTENT_NOT_BETTER', t03CompletedWithNewSupportRetainedWithoutNetGainExtensions: ['E1'] })
    expect(classifyD2FDecision({ ...base, t03SelectedExtensions: ['E1'], newSupportLostExtensions: ['E1'] })).toMatchObject({ case: 'D2F_NO_SET_COEXISTENCE', newSupportLostExtensions: ['E1'] })
    expect(classifyD2FDecision({ ...base, admittedCandidates: 0, measuredExtensions: [] }).case).toBe('D2F_NO_ADMITTED_K3_CANDIDATE')
    expect(classifyD2FDecision({ ...base, pooledCandidates: 0, admittedCandidates: 0, measuredAdmissions: 0, measuredExtensions: [], discoveryOutcome: 'ladder_exhausted' }).case).toBe('D2F_NO_K3_CANDIDATE')
    expect(classifyD2FDecision({ ...base, pooledCandidates: 0, admittedCandidates: 0, measuredAdmissions: 0, measuredExtensions: [], discoveryOutcome: 'discovery_exhausted' }).case).toBe('D2F_NO_K3_CANDIDATE')
    expect(classifyD2FDecision(base).vsD2dBest).toEqual({ subjectEvaluationId: 'I0', completedDelta: 0, conflictDelta: 0, stepsDelta: 0, better: false, equalMetrics: true })
    expect(classifyD2FDecision(base).vsD2eBestExtensionReference).toMatchObject({ completedDelta: 0, conflictDelta: 0, stepsDelta: -5 })
  })
})

// ---------------------------------------------------------------- the run analysis (synthetic records over the real derivation and a Fake RNG world)

const CTXV = { calculationContext: { ...D2F_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000 }
const PROC = (at: string) => ({ outcome: 'completed', wallMs: 1, startedAt: `2026-10-11T00:00:${at}.000Z` })
const SUMMARY = JSON.parse(phase2c2ResultRaw).baseline.summary

interface Outcome { completed?: number; conflicts?: { participants: string[]; resourceIdentity?: string | null }[]; notSelected?: string[]; status?: string; termination?: string; timeout?: boolean;
  resourceConflict?: number; extraSelectedTargets?: string[]; dropTargets?: string[] }
interface SyntheticOptions { outcomes?: Record<string, Outcome>; pooled?: number; rungs?: string[]; admissionsR1False?: number[] }
interface Synthetic { input: D2FAnalysisInput & { evaluationRows: D2FEvaluationRow[]; evaluationRecords: Map<string, Json | null>; discoveryRows: D2FDiscoveryRow[]; discoveryRecords: Map<string, Json | null> };
  v: D2FValidatedInputs; k3Ids: string[] }

/**
 * A synthetic run over the real V derivation (the real K3 context, I0, WP and support IDs) in a Fake RNG world: the Export support
 * bodies are Fake fixture Routes renamed to the real support IDs (hashing, through `shaMap`, to the registered body SHA-256), and the
 * K1 / K2 / K3 / single reservations of V are replaced by the ones the Fake Engine derives from those bodies, so the analyzer's
 * independent recomputation (C3 / C5 / C6 / C7 / C8 / RV7) runs for real.
 */
function synthetic(options: SyntheticOptions = {}): Synthetic {
  const outcomes = options.outcomes ?? {}
  const evidence = realEvidence()
  const v = validateD2FInputs(evidence)
  const k3 = v.k3!, i0 = v.i0!, X = v.newSupport!
  const shaMap = new Map<string, string>(evidence.shaMap)
  const sha = (text: string) => shaMap.get(text) ?? syncSha(text)
  const world = fixture()
  const engine = world.dependencies.rngEngine
  const template = world.input.buildListEntries[0]!
  // The Fake Routes of the K3 supports: X Resets Skills (SOURCE_D, 10), the K2 supports Reset Bonuses (SOURCE_A, 10) / Reset Skills (SOURCE_C, 9).
  const routes: Record<string, BuildListEntry['candidateSnapshot']['route']> = {}
  routes[X.supportBuildListEntryId] = resetSkillsRoute(SOURCE_D, 10)
  k3.k2SupportBuildListEntryIds.forEach((s, i) => { routes[s] = i === 0 ? resetRoute(ORCHESTRATION_SOURCE_A, 10) : resetSkillsRoute(SOURCE_C, 9) })
  const allSupports = [...new Set([...v.supports.map(s => s.supportBuildListEntryId), X.supportBuildListEntryId])]
  const supportBodies = new Map<string, BuildListEntry>()
  allSupports.forEach((s, i) => {
    const b = orchestrationEntry(s, orchestrationTarget(`target.outside.${i}`), routes[s] ?? resetRoute(ORCHESTRATION_SOURCE_B, 11))
    supportBodies.set(s, b)
    const registered = s === X.supportBuildListEntryId ? X.supportBodySha256 : v.supports.find(x => x.supportBuildListEntryId === s)!.contexts[0]!.supportBodySha256
    shaMap.set(stableStringify(b), registered)
  })
  const single = (s: string) => derivePlannerAlternativeReservation([supportBodies.get(s)!], engine)
  const k3Body = structuredClone(derivePlannerAlternativeReservation(k3.supportBuildListEntryIds.map(s => supportBodies.get(s)!), engine)) as unknown as Json
  const k2Body = structuredClone(derivePlannerAlternativeReservation(k3.k2SupportBuildListEntryIds.map(s => supportBodies.get(s)!), engine)) as unknown as Json
  // Replace V's reservation bodies by the Fake-world ones (V proved the real ones; the analyzer compares against V's values).
  for (const c of v.contexts) if (allSupports.includes(c.supportBuildListEntryId)) { const b = structuredClone(single(c.supportBuildListEntryId)) as unknown as Json; c.reservationBody = b; c.reservationDigest = hashStableValue(b) }
  v.k2Context = { ...v.k2Context!, reservationBody: k2Body, reservationDigest: hashStableValue(k2Body) }
  v.wp = { ...v.wp!, k2: { ...v.wp!.k2!, searchReservationDigest: hashStableValue(k2Body) } }
  v.registeredReservationBody = k3Body
  v.registeredNewSupportReservationBody = structuredClone(single(X.supportBuildListEntryId)) as unknown as Json
  const d2cContexts = projectD2FD2CResult(JSON.parse(d2cResultRaw), 't03')!.contexts.map(row => { const c = v.contexts.find(x => x.k === row.k); return c === undefined ? row : { ...row, reservationDigest: c.reservationDigest } })
  // Incumbent G store bodies whose stable keys hash (through shaMap) to the registered keySha256.
  const incumbentBodies = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  i0.replacements.forEach((r, n) => {
    const snapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: `series_skill.variant.${n}`, searchRunId: r.searchIdentity }
    shaMap.set(candidateStableKey(snapshot), r.keySha256)
    incumbentBodies.set(r.file, { bytes: r.bytes, sha256: r.sha256, body: { ...structuredClone(template), id: r.generatedBuildListEntryId, targetWeaponId: r.targetWeaponId,
      calculationContext: { ...D2F_CALCULATION_CONTEXT }, isStale: false, candidateSnapshot: snapshot } })
  })
  const wpK2 = v.wp!.k2!
  const wpSnapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: 'series_skill.wp', searchRunId: wpK2.searchIdentity }
  shaMap.set(candidateStableKey(wpSnapshot), wpK2.keySha256)
  const wpBody = { bytes: wpK2.bytes, sha256: wpK2.sha256, body: { ...structuredClone(template), id: wpK2.generatedBuildListEntryId, targetWeaponId: wpK2.targetWeaponId, calculationContext: { ...D2F_CALCULATION_CONTEXT },
    isStale: false, candidateSnapshot: wpSnapshot } }
  // O_t03 whose stable key hashes to the registered excluded key SHA-256.
  const oSnapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: 'series_skill.o.t03' }
  const oKey = candidateStableKey(oSnapshot)
  shaMap.set(oKey, v.k2Context.excludedRouteKeySha256s[0]!)
  const exportEntries: Json[] = [...supportBodies.values()].map(b => b as unknown as Json)
  exportEntries.push({ ...structuredClone(template), id: k3.currentBuildListEntryId, targetWeaponId: k3.targetWeaponId, candidateSnapshot: oSnapshot })
  // RV record
  const rvRecord = { ...CTXV, result: { status: 'verified', unitId: 'RV', baseline: { conflictResolutions: 0, maxPlanSteps: 20_000 }, issues: [],
    candidates: [...i0.replacements].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1).map(r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, generatedBuildListEntryId: r.generatedBuildListEntryId,
      generatedEntry: { file: r.file, sha256Observed: r.sha256 }, RV1: { bodySha256Matched: true, idMatched: true, targetMatched: true, calculationContextMatched: true, notStale: true, searchRunIdMatched: true, keySha256Matched: true },
      RV2: { status: 'not_recomputed', replacedBuildListEntryId: null, satisfied: null },
      RV3: { reservationSource: r.origin === 'd2b_k0' ? 'k0_empty' : 'ctx_record', reservationDigest: r.origin === 'd2b_k0' ? D2E_K0_RESERVATION_DIGEST : v.contexts.find(c => c.k === r.contextK)!.reservationDigest, matched: true, issues: [] },
      RV4: { respects: true, blockedHits: { normal: [], gogma: [], skill: [] }, exclusiveHit: [] }, satisfied: true })),
    supports: v.supports.map(s => ({ supportBuildListEntryId: s.supportBuildListEntryId, contextRecords: s.contexts.map(c => c.k), RV5: { expected: s.contexts.map(c => c.supportBodySha256), observed: s.contexts[0]!.supportBodySha256, exportBodies: 1, matched: true },
      RV6: { digestExpected: s.contexts.map(c => c.reservationDigest), digestObserved: s.contexts[0]!.reservationDigest, digestMatched: true, bodyObserved: structuredClone(s.contexts[0]!.reservationBody), bodyMatched: true, satisfied: true } })),
    newSupport: { supportBuildListEntryId: X.supportBuildListEntryId, RV7: { exportBodies: 1, bodySha256Expected: X.supportBodySha256, bodySha256Observed: X.supportBodySha256, bodyMatched: true,
      digestExpected: hashStableValue(v.registeredNewSupportReservationBody), digestObserved: hashStableValue(v.registeredNewSupportReservationBody), digestMatched: true,
      reservationBodyObserved: structuredClone(v.registeredNewSupportReservationBody), reservationBodyMatched: true, satisfied: true } },
    wpCandidate: { generatedBuildListEntryId: wpK2.generatedBuildListEntryId, RV8: { generatedEntry: {}, bodySha256Matched: true, idMatched: true, targetMatched: true, calculationContextMatched: true, notStale: true,
      searchRunIdMatched: true, keySha256Matched: true, replacement: { status: 'ready', replacedBuildListEntryId: k3.currentBuildListEntryId, satisfied: true }, r0: { respects: true, blockedHits: {}, exclusiveHit: [] }, satisfied: true } } } }
  const rvRow = { unitId: 'RV', status: 'verified', notExecutedReason: null, process: PROC('00'), recordFile: { file: 'RV.record.json', bytes: 1, sha256: 'r' } }
  // CTX-K3
  const singles = Object.fromEntries(k3.supportBuildListEntryIds.map(s => { const b = structuredClone(single(s)) as unknown as Json; return [s, { reservationBody: b, reservationDigest: hashStableValue(b) }] }))
  const referenced = [ORCHESTRATION_SOURCE_A, SOURCE_C, SOURCE_D].sort()
  const contextRecord = { ...CTXV, result: { status: 'context_ready', unitId: 'CTX-K3', contextId: k3.contextId, label: k3.label, targetWeaponId: k3.targetWeaponId, currentBuildListEntryId: k3.currentBuildListEntryId,
    supportBuildListEntryIds: k3.supportBuildListEntryIds, newSupportBuildListEntryId: X.supportBuildListEntryId, supportTargetWeaponIds: k3.supportBuildListEntryIds.map(() => null),
    supportBodySha256s: Object.fromEntries(k3.supportBuildListEntryIds.map(s => [s, sha(stableStringify(supportBodies.get(s)))])),
    reservationBody: structuredClone(k3Body), reservationDigest: hashStableValue(k3Body), singleSupportReservations: singles, originDigest: D2E_ORIGIN_DIGEST, scheduleOriginDigest: D2E_ORIGIN_DIGEST, excludedRouteKeys: [oKey],
    excludedRouteKeySha256s: [v.k2Context.excludedRouteKeySha256s[0]], scheduleExcludedRouteKeys: [oKey], conflictContextCount: 21,
    checks: { C1: { satisfied: true, issues: [] }, C2: { satisfied: true, issues: [] }, C3: { satisfied: true, referencedOwnedWeaponIds: referenced, exclusiveConsumedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A],
      exclusiveOwnedWeaponIds: [...(k3Body.exclusiveOwnedWeaponIds as string[])].sort(), routeUnitRejections: 0 }, C4: { satisfied: true, issues: [] },
      C5: { state: 'matched', expectedDigest: hashStableValue(k3Body), observedDigest: hashStableValue(k3Body), digestMatched: true, bodyMatched: true },
      C6: { satisfied: true, k2Contained: true, perSupport: [], newSupportContained: true },
      C7: { satisfied: true, permutations: d2fPermutations(k3.supportBuildListEntryIds).map(order => ({ order, digest: hashStableValue(k3Body), bodyMatched: true })) },
      C8: { state: 'matched', expectedDigest: singles[X.supportBuildListEntryId]!.reservationDigest, observedDigest: singles[X.supportBuildListEntryId]!.reservationDigest, bodyMatched: true, existingSupportsMatched: true, perExistingSupport: [] } },
    diagnostics: { equalsK1ComponentwiseUnion: stableStringify(d2eUnion(Object.values(singles).map(x => x.reservationBody))) === stableStringify(k3Body),
      equalsK2UnionNewSupport: stableStringify(d2eUnion([k2Body, singles[X.supportBuildListEntryId]!.reservationBody])) === stableStringify(k3Body), registeredResources: [] }, issues: [] } }
  const contextRow = { unitId: 'CTX-K3', contextId: k3.contextId, status: 'context_ready', notExecutedReason: null, process: PROC('03'), recordFile: { file: 'CTX-K3.context.json', bytes: 1, sha256: 'c' } }
  // DSC: L0 / L1 extent bound, L2 pools `pooled` Candidates (cap at 2).
  const pooledCount = options.pooled ?? 2
  const rungs = options.rungs ?? ['L0', 'L1', 'L2']
  const discoveryRows: D2FDiscoveryRow[] = [], discoveryRecords = new Map<string, Json | null>()
  const poolFiles = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  const k3Ids: string[] = []
  const searchIdentity = 'planner-alternative-search.synthetic'
  for (const rung of rungs) {
    const last = rung === 'L2'
    const unitId = `DSC-K3-${rung}`
    const pooled: Json[] = [], deliveries: Json[] = []
    if (last) for (let n = 1; n <= pooledCount; n += 1) {
      const snapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: `series_skill.k3.${n}`, searchRunId: searchIdentity, targetWeaponId: k3.targetWeaponId }
      const key = candidateStableKey(snapshot)
      const id = `build-list.k3.synthetic.${n}`
      k3Ids.push(id)
      const file = `${k3.contextId}-c${n}.generated-entry.json`
      poolFiles.set(file, { bytes: 10, sha256: `g${n}`, body: { ...structuredClone(template), id, targetWeaponId: k3.targetWeaponId, candidateSnapshot: snapshot } })
      const r0Split = Object.fromEntries(k3.supportBuildListEntryIds.map(s => [s, true]))
      deliveries.push({ indexInUnit: n - 1, candidateStableKey: key, keySha256: syncSha(key), cost: 300, action: 'pooled', r0K3: true, r0K2: true, r0Split, matchedD2bOrdinal: null, matchedD2cK1: null, matchedD2eK2Ordinal: null })
      pooled.push({ indexInContext: n, indexInUnit: n - 1, candidateStableKey: key, keySha256: syncSha(key), cost: 300, routeKind: 'existing_gogma_mixed', routeOperationCount: 300,
        r0K3: { respects: true, blockedHits: {}, exclusiveHit: [] }, r0K2: true, r0Split, searchIdentity, reservationDigest: hashStableValue(k3Body), generatedBuildListEntryId: id, reusedExisting: false,
        replacement: { status: 'ready', replacedBuildListEntryId: k3.currentBuildListEntryId }, requiresSupport: [...k3.supportBuildListEntryIds], generatedEntry: null,
        generatedEntryFile: { file, bytes: 10, sha256: `g${n}` } })
    }
    const stoppedByConsumer = last && pooledCount === 2
    const status = stoppedByConsumer ? 'discovery_cap_reached' : last ? 'ladder_exhausted' : 'stopped_by_search_extent_bound'
    discoveryRows.push({ unitId, contextId: k3.contextId, rung, status, notExecutedReason: null, process: PROC('04'), recordFile: { file: `${unitId}.record.json`, bytes: 1, sha256: rung } })
    discoveryRecords.set(unitId, { ...CTXV, result: { status, unitId, contextId: k3.contextId, rung, poolSizeAtStart: 0, deliveries, pooled, searchIdentity,
      observedContext: { reservationDigest: hashStableValue(k3Body), originDigest: D2E_ORIGIN_DIGEST, excludedRouteKeys: [oKey], currentBuildListEntryId: k3.currentBuildListEntryId, supportBuildListEntryIds: [...k3.supportBuildListEntryIds] },
      search: { deliveredCandidates: deliveries.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: !stoppedByConsumer, stoppedByConsumer, skippedExcludedRouteKeys: 1 },
      timing: { searchVisitMs: 1, materializeMs: 0, searchOnlyMs: 1 } } })
  }
  // Evaluations
  const evaluationRows: D2FEvaluationRow[] = [], evaluationRecords = new Map<string, Json | null>()
  const authOf = (s: string) => s === X.supportBuildListEntryId ? { reservationDigest: singles[s]!.reservationDigest, reservationBody: singles[s]!.reservationBody, supportBodySha256: X.supportBodySha256 }
    : (() => { const c = v.supports.find(x => x.supportBuildListEntryId === s)!.contexts[0]!; return { reservationDigest: c.reservationDigest, reservationBody: c.reservationBody, supportBodySha256: c.supportBodySha256 } })()
  const ownCtx = (contextId: string | null) => v.contexts.find(c => c.contextId === contextId)!
  type Rep = { label: string; targetWeaponId: string; generatedBuildListEntryId: string; sha256: string; requiresSupport: string[]; contextId: string | null; kind: 'k0' | 'k1' | 'k2' | 'k3' }
  const i0Reps: Rep[] = i0.replacements.map(r => ({ label: r.label, targetWeaponId: r.targetWeaponId, generatedBuildListEntryId: r.generatedBuildListEntryId, sha256: r.sha256, requiresSupport: r.requiresSupport,
    contextId: r.contextId, kind: r.origin === 'd2b_k0' ? 'k0' : 'k1' }))
  const wpRep: Rep = { label: k3.label, targetWeaponId: wpK2.targetWeaponId, generatedBuildListEntryId: wpK2.generatedBuildListEntryId, sha256: wpK2.sha256, requiresSupport: [...wpK2.requiresSupport], contextId: v.k2Context.contextId, kind: 'k2' }
  const k3Rep = (n: number): Rep => ({ label: k3.label, targetWeaponId: k3.targetWeaponId, generatedBuildListEntryId: k3Ids[n - 1]!, sha256: `g${n}`, requiresSupport: [...k3.supportBuildListEntryIds], contextId: k3.contextId, kind: 'k3' })
  const evalOf = (id: string, stage: 'B0' | 'I0' | 'WP' | 'ADM' | 'EXT', ordinal: number | null, repsIn: Rep[], o: Outcome) => {
    const reps = [...repsIn].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1)
    const generated = reps.map(r => r.generatedBuildListEntryId)
    const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort()
    const digest = d1InputDigest(reps.map(r => r.targetWeaponId), generated, reps.map(r => r.sha256), EXPORT_SHA)
    const row: D2FEvaluationRow = { evaluationId: id, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', ordinal,
      replacementTargets: reps.map(r => r.targetWeaponId), generatedEntryIds: generated, generatedEntrySha256s: reps.map(r => r.sha256), requiresSupport: support, inputDigest: digest,
      registeredInputDigest: stage === 'B0' ? D2E_B0_EXPECTED.inputDigest : stage === 'I0' ? D2E_I0_EXPECTED.inputDigest : stage === 'WP' ? D2F_WP_EXPECTED.inputDigest : null, status: 'evaluated', notExecutedReason: null,
      process: PROC('05'), recordFile: { file: `${id}.record.json`, bytes: 1, sha256: 'e' }, runner: null }
    if (o.status !== undefined) row.status = o.status
    evaluationRows.push(row)
    if (o.timeout) { Object.assign(row, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1, startedAt: PROC('05').startedAt }, recordFile: null }); return null }
    const notSelected = new Set(o.notSelected ?? [])
    // The new support is outside the B0 / I0 / ADM sets and selected there (as in the D2-E I0); the WP set loses it (as D2-E EXT-c2 did).
    const outsideX = stage === 'B0' || stage === 'I0' || stage === 'ADM' ? [X.supportBuildListEntryId] : []
    const selected = [...new Set([...generated, ...support, ...outsideX, 'build-list.other.1', 'build-list.other.2'])].filter(x => !notSelected.has(x)).sort()
    const defaultConflicts = stage === 'B0' ? 21 : stage === 'ADM' ? 21 : 19
    const conflicts = (o.conflicts ?? Array.from({ length: defaultConflicts }, (_, i): { participants: string[]; resourceIdentity?: string | null } => ({ participants: [`x${i}a`, `x${i}b`] }))).map((c, i) => ({ id: `c${i}`, kind: 'same_skill_counter',
      participants: [...c.participants].sort(), selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: c.resourceIdentity ?? null, resourceIdentityMatched: c.resourceIdentity != null }))
    const staticChecks = Object.fromEntries(support.map(s => [s, { S4: true, S5: { digestExpected: authOf(s).reservationDigest, digestObserved: authOf(s).reservationDigest, digestMatched: true,
      bodyExpected: structuredClone(authOf(s).reservationBody), bodyObserved: structuredClone(authOf(s).reservationBody), bodyMatched: true, satisfied: true } }]))
    const reservationChecks = Object.fromEntries(reps.filter(r => r.kind !== 'k0').map(r => [r.generatedBuildListEntryId, r.kind === 'k1'
      ? { kind: 'k1_own_context', contextId: r.contextId, digestExpected: ownCtx(r.contextId).reservationDigest, digestObserved: ownCtx(r.contextId).reservationDigest, digestMatched: true, bodyMatched: true, searchInputDigestMatched: null, satisfied: true }
      : r.kind === 'k2' ? { kind: 'k2_pair', contextId: r.contextId, digestExpected: hashStableValue(k2Body), digestObserved: hashStableValue(k2Body), digestMatched: true, bodyMatched: true, searchInputDigestMatched: true, satisfied: true }
        : { kind: 'k3_set', contextId: r.contextId, digestExpected: hashStableValue(k3Body), digestObserved: hashStableValue(k3Body), digestMatched: true, bodyMatched: true, searchInputDigestMatched: true, satisfied: true }]))
    const targetOf = new Map<string, string>([...reps.map(r => [r.generatedBuildListEntryId, r.targetWeaponId] as [string, string]), [X.supportBuildListEntryId, X.supportTargetWeaponId]])
    const selectedTargets = [...new Set([...selected.map(x => targetOf.get(x) ?? `other:${x}`), ...(o.extraSelectedTargets ?? [])])].filter(t => !(o.dropTargets ?? []).includes(t)).sort()
    const defaultCompleted = stage === 'B0' ? 20 : stage === 'ADM' ? 20 : 24
    const rejected = Array.from({ length: o.resourceConflict ?? (stage === 'B0' ? 21 : 19) }, (_, i) => ({ buildListEntryId: `build-list.rejected.${i}`, reason: 'resource_conflict' }))
    const facts = { preflight: { status: stage === 'B0' ? 'not_run' : 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
      plan: { present: true, termination: { status: o.termination ?? 'exhausted', completedTargetCount: o.completed ?? defaultCompleted, totalTargetCount: 43, reachedLimits: [] }, steps: stage === 'WP' ? 1470 : 1465,
        selectedBuildListEntryIds: selected, warningKinds: [] },
      conflicts, routeCommitment: [...generated, ...support].map(g => ({ buildListEntryId: g, role: generated.includes(g) ? 'generated' : 'support', status: notSelected.has(g) ? 'dropped' : 'committed',
        provisionalOutcomeSelectedBuildListEntryId: notSelected.has(g) ? 'winner.x' : null, rejectionReasons: [] })),
      supportChecks: Object.fromEntries(support.map(s => [s, { S1: true, S2: true, S3: true, S4: true, S5: true }])), trialRunSummary: null,
      trialVerdict: stage === 'ADM' ? { status: 'found_R', generatedSelected: true } : null, baselineSummary: stage === 'B0' ? structuredClone(SUMMARY) : null, steps: [], resultDigest: '',
      rejectedBuildListEntries: rejected, resourceConflictRejections: rejected.length, selectedTargetWeaponIds: selectedTargets, supportStaticChecks: staticChecks,
      supportBodySha256Observed: Object.fromEntries(support.map(s => [s, authOf(s).supportBodySha256])), childRecheck: { checked: reps.length, issues: [] }, replacementReservationChecks: reservationChecks }
    facts.resultDigest = d1ResultDigest(facts as unknown as D2EvaluationFacts)
    evaluationRecords.set(id, { ...CTXV, inputDigest: digest, result: { status: o.status ?? 'evaluated', ...facts } })
    return facts
  }
  const b0 = evalOf('B0', 'B0', null, [], outcomes.B0 ?? {})
  const i0f = evalOf('I0', 'I0', null, i0Reps, outcomes.I0 ?? {})
  const wpf = evalOf(v.wp!.evaluationId, 'WP', null, [...i0Reps, wpRep], outcomes.WP ?? {})
  for (let n = 1; n <= pooledCount; n += 1) {
    const r1False = (options.admissionsR1False ?? []).includes(n)
    evalOf(`ADM-K3-t03-c${n}`, 'ADM', n, [k3Rep(n)], outcomes[`ADM-K3-t03-c${n}`] ?? (r1False ? { status: 'preflight_refused' } : {}))
  }
  for (let n = 1; n <= pooledCount; n += 1) {
    if ((options.admissionsR1False ?? []).includes(n)) continue
    evalOf(`EXT-K3-t03-c${n}`, 'EXT', n, [...i0Reps, k3Rep(n)], outcomes[`EXT-K3-t03-c${n}`] ?? {})
  }
  // The synthetic B0 / I0 / WP results are the parity expectations of this synthetic run (the real ones are registered constants).
  v.expected = { b0: { ...v.expected!.b0, resultDigest: b0?.resultDigest ?? v.expected!.b0.resultDigest }, i0: { ...v.expected!.i0, resultDigest: i0f?.resultDigest ?? v.expected!.i0.resultDigest },
    wp: { ...v.expected!.wp, resultDigest: wpf?.resultDigest ?? v.expected!.wp.resultDigest } }
  v.priorByInputDigest = { [D2E_B0_EXPECTED.inputDigest]: [{ source: 'D2-E', evaluationId: 'B0', status: 'evaluated', inputDigest: D2E_B0_EXPECTED.inputDigest, resultDigest: b0?.resultDigest ?? 'x' }],
    [D2E_I0_EXPECTED.inputDigest]: [{ source: 'D2-E', evaluationId: 'I0', status: 'evaluated', inputDigest: D2E_I0_EXPECTED.inputDigest, resultDigest: i0f?.resultDigest ?? 'x' }],
    [D2F_WP_EXPECTED.inputDigest]: [{ source: 'D2-E', evaluationId: 'EXT-K2-t03-c2', status: 'evaluated', inputDigest: D2F_WP_EXPECTED.inputDigest, resultDigest: wpf?.resultDigest ?? 'x' }] }
  const childProcessCount = 1 + 1 + discoveryRows.length + evaluationRows.filter(r => r.process !== null).length
  const input: Synthetic['input'] = { validated: v, exportSha256: EXPORT_SHA, exportBuildListEntries: exportEntries, baselineInput: null, recomputedOriginDigest: D2E_ORIGIN_DIGEST, d2cContexts, rngEngine: engine,
    incumbentBodies, wpBody, rvRow, rvRecord, contextRow, contextRecord, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords, interrupted: false, discoveryEnvelopeReached: false,
    runEnvelopeReached: false, abortReason: null, provenanceIssues: [], evidenceIssues: [], rawConsistencyIssues: [], childProcessCount, sha256OfText: sha }
  return { input, v, k3Ids }
}
const d2eUnion = (bodies: readonly Json[]) => {
  const nums = (x: unknown) => Array.isArray(x) ? x.filter((y): y is number => typeof y === 'number') : []
  const merge = (lists: number[][]) => [...new Set(lists.flat())].sort((a, b) => a - b)
  const stream = (key: string) => ({ held: merge(bodies.map(b => nums((b[key] as Json | undefined)?.held))), blocked: merge(bodies.map(b => nums((b[key] as Json | undefined)?.blocked))) })
  const counters = [...new Set(bodies.flatMap(b => (b.normal as Json[]).map(n => String(n.counterId))))].sort()
  return { normal: counters.map(counterId => { const ns = bodies.flatMap(b => (b.normal as Json[]).filter(n => n.counterId === counterId)); return { counterId, held: merge(ns.map(n => nums(n.held))), blocked: merge(ns.map(n => nums(n.blocked))) } }),
    skill: stream('skill'), gogma: stream('gogma'), exclusiveOwnedWeaponIds: [...new Set(bodies.flatMap(b => b.exclusiveOwnedWeaponIds as string[]))].sort() }
}
const analyze = (s: Synthetic, over: Partial<D2FAnalysisInput> = {}) => analyzeD2FRun({ ...s.input, ...over })
const states = (r: ReturnType<typeof analyze>) => Object.fromEntries(r.parityChecks.map(c => [c.checkId, c.state]))
const categories = (r: ReturnType<typeof analyze>) => r.invalidReasons.map(x => x.category)

describe('D2-F run analysis (§5 - §12)', () => {
  it('replays a clean run: every parity matched, CTX-K3 recomputed, the pool / ADM / EXT re-derived, an improved EXT decides EXCEEDS', () => {
    const s = synthetic({ outcomes: { 'EXT-K3-t03-c1': { completed: 25, conflicts: Array.from({ length: 18 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] })) } } })
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(Object.values(states(r)).every(x => x === 'matched' || x === 'not_applicable')).toBe(true)
    expect(states(r)).toMatchObject({ 'baseline:B0': 'matched', 'd2d_best:I0': 'matched', 'd2e_i0:I0': 'matched', 'registered_input:I0': 'matched', [`d2e_wrapper:${s.v.wp!.evaluationId}`]: 'matched',
      'k3_context_registered:CTX-K3': 'matched', 'k1_new_support_registered:CTX-K3+RV7': 'matched', 'k2_context_prior:CTX-K2': 'matched', 'k1_context:CTX-3': 'matched' })
    expect(r.rv).toMatchObject({ status: 'verified', satisfied: true })
    expect(r.context.checks).toMatchObject({ C1: true, C2: true, C3: { satisfied: true, routeUnitRejections: 0 }, C4: true, C5: { state: 'matched' }, C6: { satisfied: true, k2Contained: true, newSupportContained: true },
      C7: { satisfied: true }, C8: { state: 'matched', existingSupportsMatched: true } })
    expect(r.discovery.units.map(u => u.status)).toEqual(['stopped_by_search_extent_bound', 'stopped_by_search_extent_bound', 'discovery_cap_reached'])
    expect(r.discovery.pool.map(p => p.ordinal)).toEqual([1, 2])
    expect(r.evaluations.map(e => e.evaluationId)).toEqual(['B0', 'I0', s.v.wp!.evaluationId, 'ADM-K3-t03-c1', 'ADM-K3-t03-c2', 'EXT-K3-t03-c1', 'EXT-K3-t03-c2'])
    const adm = r.evaluations.find(e => e.evaluationId === 'ADM-K3-t03-c1')!
    expect(adm.r1r4).toMatchObject({ R1: true, foundRDiagnostic: true, newSupport: { selected: true, targetSelected: true } })
    expect(adm.setReservationCheck).toMatchObject({ S6: { kind: 'k3_set', satisfied: true, searchInputDigestMatched: true } })
    const wp = r.evaluations.find(e => e.stage === 'WP')!
    expect(wp.setReservationCheck).toMatchObject({ S6: { kind: 'k2_pair', satisfied: true } })
    expect(wp).toMatchObject({ eligible: false, improved: false, extension: null })
    const ext1 = r.evaluations.find(e => e.evaluationId === 'EXT-K3-t03-c1')!
    expect(ext1).toMatchObject({ eligible: true, improved: true, improvementKind: 'completed_increase', requiresSupport: [...s.v.k3!.supportBuildListEntryIds, ...s.v.supports.map(x => x.supportBuildListEntryId)].filter((x, i, a) => a.indexOf(x) === i).sort() })
    expect(ext1.requiresSupport).toHaveLength(4)
    expect(ext1.extension).toMatchObject({ t03: { selected: true, targetSelected: true }, newSupport: { selected: true, targetSelected: true }, newSupportTargetRetained: true,
      t03Completion: { t03TargetCompleted: true, newSupportTargetRetained: true, netCompletedDelta: 1, t03CompletedWithoutNetGain: false, t03CompletedWithNewSupportRetainedWithoutNetGain: false } })
    const ext2 = r.evaluations.find(e => e.evaluationId === 'EXT-K3-t03-c2')!
    expect(ext2.extension).toMatchObject({ t03Completion: { t03TargetCompleted: true, newSupportTargetRetained: true, netCompletedDelta: 0, t03CompletedWithoutNetGain: true, t03CompletedWithNewSupportRetainedWithoutNetGain: true } })
    expect(ext2).toMatchObject({ eligible: true, improved: false, equalMetrics: true })
    expect(r.decision).toMatchObject({ case: 'D2F_EXCEEDS_D2D_BEST', bestEligibleExtension: 'EXT-K3-t03-c1', bestImprovedExtension: 'EXT-K3-t03-c1', improvementKind: 'completed_increase', wrapperParity: 'matched',
      t03CompletedWithNewSupportRetainedWithoutNetGainExtensions: ['EXT-K3-t03-c2'], newSupportSelectedExtensions: ['EXT-K3-t03-c1', 'EXT-K3-t03-c2'] })
    expect(r.extensions.ranking.map(x => x.evaluationId)).toEqual(['EXT-K3-t03-c1', 'EXT-K3-t03-c2'])
    expect(r.aggregates.childProcesses).toEqual({ registeredMax: 12, started: 12 })
    expect(r.comparison.wrapperParity).toMatchObject({ state: 'matched' })
  })

  it('decides NO_SET_COEXISTENCE when the new support is lost (R5(2)), SET_COEXISTENT_NOT_BETTER when both Targets hold without net gain, and records the K2 failure resources', () => {
    const s0 = synthetic()
    const X = s0.v.newSupport!
    const g1 = s0.k3Ids[0]!
    const skill648 = s0.v.resourceIdentities.k2Failure.find(r => r.includes('"counterBefore":648'))!
    const lost = analyze(synthetic({ outcomes: {
      'EXT-K3-t03-c1': { notSelected: [X.supportBuildListEntryId], dropTargets: [X.supportTargetWeaponId], extraSelectedTargets: ['target.other.gained'],
        conflicts: [{ participants: [g1, X.supportBuildListEntryId], resourceIdentity: skill648 }, { participants: [g1, 'build-list.outside.1'], resourceIdentity: skill648 }, ...Array.from({ length: 17 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] }))] },
      'EXT-K3-t03-c2': { notSelected: [X.supportBuildListEntryId], dropTargets: [X.supportTargetWeaponId] } } }))
    expect(lost.invalidReasons).toEqual([])
    expect(lost.decision).toMatchObject({ case: 'D2F_NO_SET_COEXISTENCE', newSupportLostExtensions: ['EXT-K3-t03-c1', 'EXT-K3-t03-c2'], t03SelectedExtensions: ['EXT-K3-t03-c1', 'EXT-K3-t03-c2'] })
    const e1 = lost.evaluations.find(e => e.evaluationId === 'EXT-K3-t03-c1')!
    expect((e1.r5 as Json).failureReasons).toEqual(expect.arrayContaining(['support_not_selected', 'conflict_within_set']))
    expect(e1.extension).toMatchObject({ newSupport: { selected: false, targetSelected: false, winnerBuildListEntryId: 'winner.x' }, newSupportTargetRetained: false })
    expect(((e1.extension as Json).k2FailureResourcesObserved as Json[]).find(x => x.resourceIdentity === skill648)).toMatchObject({ withT03G: true, withNewSupport: true })
    expect(((e1.extension as Json).outsideSetConflictsWithT03G as Json[])).toHaveLength(1)
    expect(((e1.extension as Json).conflictsWithinSet as Json[])).toHaveLength(1)
    const retained = analyze(synthetic({ outcomes: { 'EXT-K3-t03-c1': { completed: 23 } } }))
    expect(retained.decision).toMatchObject({ case: 'D2F_SET_COEXISTENT_NOT_BETTER', r5OnlyEligibleExtensions: ['EXT-K3-t03-c1'], bestEligibleExtension: 'EXT-K3-t03-c2',
      t03CompletedWithNewSupportRetainedWithoutNetGainExtensions: ['EXT-K3-t03-c1', 'EXT-K3-t03-c2'] })
  })

  it('decides NO_K3_CANDIDATE and NO_ADMITTED_K3_CANDIDATE, and GLOBAL_COMPLETE_R only with 43 / 43, Conflict 0, no resource_conflict and R5', () => {
    const empty = analyze(synthetic({ pooled: 0 }))
    expect(empty.invalidReasons).toEqual([])
    expect(empty.decision).toMatchObject({ case: 'D2F_NO_K3_CANDIDATE', discoveryOutcome: 'ladder_exhausted', pooledCandidates: 0 })
    const noAdm = analyze(synthetic({ admissionsR1False: [1, 2] }))
    expect(noAdm.invalidReasons).toEqual([])
    expect(noAdm.decision).toMatchObject({ case: 'D2F_NO_ADMITTED_K3_CANDIDATE', pooledCandidates: 2, admittedCandidates: 0 })
    const complete = analyze(synthetic({ outcomes: { 'EXT-K3-t03-c1': { completed: 43, termination: 'completed', conflicts: [], resourceConflict: 0 } } }))
    expect(complete.decision.case).toBe('D2F_GLOBAL_COMPLETE_R')
    const nearly = analyze(synthetic({ outcomes: { 'EXT-K3-t03-c1': { completed: 43, termination: 'completed', conflicts: [], resourceConflict: 1 } } }))
    expect(nearly.decision.case).toBe('D2F_EXCEEDS_D2D_BEST')
  })

  it('reads timeout / not_executed as unmeasured (INCOMPLETE, a lower bound), never as no Candidate / non-coexistence; an unmeasured WP is not_checked', () => {
    const r = analyze(synthetic({ outcomes: { 'EXT-K3-t03-c2': { timeout: true } } }))
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2F_INCOMPLETE', lowerBound: true, unmeasuredEvaluations: ['EXT-K3-t03-c2'], k3CandidateObservedUnderIncomplete: true })
    // A timed-out L2: the discovery is unmeasured, no ADM / EXT follows.
    const l2 = synthetic({ pooled: 0 })
    Object.assign(l2.input.discoveryRows[2]!, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1, startedAt: PROC('04').startedAt }, recordFile: null })
    l2.input.discoveryRecords.delete('DSC-K3-L2')
    const u = analyze(l2, { childProcessCount: 8 })
    expect(u.invalidReasons).toEqual([])
    expect(u.decision).toMatchObject({ case: 'D2F_INCOMPLETE', discoveryOutcome: 'unmeasured', unmeasuredEvaluations: ['DSC-K3-L2'] })
    // An unmeasured WP: d2e_wrapper not_checked, INCOMPLETE, every other stage measured.
    const wp = analyze(synthetic({ outcomes: { WP: { timeout: true } } }))
    expect(wp.invalidReasons).toEqual([])
    expect(wp.decision).toMatchObject({ case: 'D2F_INCOMPLETE', wrapperParity: 'not_checked' })
    expect(wp.decision.unmeasuredEvaluations).toEqual([wp.evaluations.find(e => e.stage === 'WP')!.evaluationId])
  })

  it('makes an I0 / WP parity mismatch, a C5 / C8 / C3 / C7 tamper, an RV7 tamper, an S6 failure, a wrong delivery action and a missing record INVALID', () => {
    const mutate = (fn: (s: Synthetic) => void, over: Partial<D2FAnalysisInput> = {}) => { const s = synthetic(); fn(s); return analyze(s, over) }
    const fact = (s: Synthetic, id: string) => (s.input.evaluationRecords.get(id)!.result as Json)
    const redigest = (s: Synthetic, id: string) => { const f = fact(s, id); f.resultDigest = d1ResultDigest(f as unknown as D2EvaluationFacts) }
    const ctxResult = (s: Synthetic) => s.input.contextRecord!.result as Json
    expect(categories(mutate(s => { fact(s, 'I0').conflicts = []; redigest(s, 'I0') }))).toContain('d2d_parity')
    expect(categories(mutate(s => { (fact(s, s.v.wp!.evaluationId).plan as Json).steps = 1465; redigest(s, s.v.wp!.evaluationId) }))).toContain('wrapper_parity')
    expect(categories(mutate(s => { (fact(s, 'B0').plan as Json).steps = 1466; redigest(s, 'B0') }))).toContain('baseline_parity_mismatch')
    // C5: a record body / digest that is not the registered one (the analyzer re-derives it from the Export bodies too).
    expect(categories(mutate(s => { const r = ctxResult(s); (r.reservationBody as Json).exclusiveOwnedWeaponIds = []; r.reservationDigest = hashStableValue(r.reservationBody) })))
      .toEqual(expect.arrayContaining(['k3_context_parity', 'guardrail']))
    // C8: the new support single the record holds is not the registered one.
    expect(categories(mutate(s => { const r = ctxResult(s); const x = (r.singleSupportReservations as Json)[s.v.newSupport!.supportBuildListEntryId] as Json; (x.reservationBody as Json).exclusiveOwnedWeaponIds = ['owned.other']; x.reservationDigest = hashStableValue(x.reservationBody) })))
      .toContain('guardrail')
    // C3 / C7: tampered record sets / permutations.
    expect(categories(mutate(s => { ((ctxResult(s).checks as Json).C3 as Json).exclusiveConsumedOwnedWeaponIds = [] }))).toContain('guardrail')
    expect(categories(mutate(s => { ((ctxResult(s).checks as Json).C7 as Json).satisfied = false }))).toContain('raw_result_mismatch')
    // RV7: the recorded digest is not the one the analyzer re-derives from the Export body.
    expect(categories(mutate(s => { (((s.input.rvRecord!.result as Json).newSupport as Json).RV7 as Json).digestObserved = 'fnv1a32:00000000' }))).toContain('raw_result_mismatch')
    // A support body of the Export that is not the registered one (RV7 / S4 / C1 fail).
    expect(categories(mutate(s => { s.input.exportBuildListEntries = (s.input.exportBuildListEntries as Json[]).map(e => e.id === s.v.newSupport!.supportBuildListEntryId ? { ...e, memo: 'changed' } : e) })))
      .toContain('guardrail')
    expect(categories(mutate(s => { const rc = fact(s, 'EXT-K3-t03-c1').replacementReservationChecks as Record<string, Json>; for (const v of Object.values(rc)) if (v.kind === 'k3_set') v.searchInputDigestMatched = false }))).toContain('guardrail')
    expect(categories(mutate(s => { ((s.input.discoveryRecords.get('DSC-K3-L2')!.result as Json).deliveries as Json[])[0]!.action = 'same_key_as_d2e_k2_pool' }))).toContain('raw_result_mismatch')
    expect(categories(mutate(s => { ((s.input.discoveryRecords.get('DSC-K3-L2')!.result as Json).deliveries as Json[])[0]!.r0Split = { a: true } }))).toContain('guardrail')
    expect(categories(mutate(s => { ((s.input.discoveryRecords.get('DSC-K3-L2')!.result as Json).deliveries as Json[])[0]!.r0K2 = false }))).toContain('guardrail')
    expect(categories(mutate(s => { s.input.evaluationRecords.set('EXT-K3-t03-c2', null) }))).toContain('evidence_integrity')
    expect(categories(mutate(s => { ((s.input.rvRecord!.result as Json).candidates as Json[])[0]!.RV4 = { respects: false, blockedHits: { skill: [341] }, exclusiveHit: [] } }))).toContain('guardrail')
    expect(categories(mutate(s => { s.input.wpBody = { ...s.input.wpBody!, sha256: '0'.repeat(64) } }))).toContain('guardrail')
    expect(mutate(() => undefined, { abortReason: 'x' }).decision.case).toBe('D2F_INVALID')
    expect(mutate(() => undefined, { rngEngine: null }).decision.case).toBe('D2F_INVALID')
  })
})

// ---------------------------------------------------------------- isolation, sources and Production (§11.2 / §11.3 / G53 - G61)

const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
function benchmarkClosure(entry: string): string[] {
  const seen = new Set<string>(), stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = benchmarkSources[file]
    if (source === undefined) throw new Error(`no source for ${file}`)
    for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.\/[^']+)'/g)) stack.push(`${match[1]}.ts`)
  }
  return [...seen].sort()
}

describe('D2-F oracle isolation, sources and Production (§11.2 / §11.3 / G53 - G61)', () => {
  it('reaches no oracle, Phase B analysis, population-authority, Phase 2-C2.5-D2-D / D2-E / D2-F module', () => {
    for (const entry of ['./plannerGlobalD2F.ts', './plannerGlobalD2FAnalysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalD2E.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound|Phase2C25D2D|Phase2C25D2E|Phase2C25D2F/.test(f))).toEqual([])
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD2.ts', '/src/benchmarks/plannerGlobalD2F.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD2F.ts', '/src/benchmarks/plannerGlobalD2FAnalysis.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/domain/models/hashing.ts', '/src/domain/planner/replacement/plannerSearchOrigin.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(codeOnly(analyzerSource)).toMatch(/rngEngine, incumbentBodies, wpBody/)
    expect(codeOnly(analyzerSource)).toMatch(/baselineInput, recomputedOriginDigest/)
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|_1657_|PHASE2C25D2|PHASE2C27B_FORMAL_TARGETS|phase2c25d2/)
  })

  it('hard-codes no Target, Entry or stable key; every fnv1a32 digest in the code is a registered one', () => {
    const v = validateD2FInputs(realEvidence())
    const ids = [...v.i0!.replacements.flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.generatedBuildListEntryId, r.searchIdentity, r.keySha256]), v.k3!.targetWeaponId, v.k3!.currentBuildListEntryId,
      ...v.k3!.supportBuildListEntryIds, ...v.k3!.supportTargetWeaponIds, ...v.k3!.lostTargetWeaponIds, v.wp!.k2!.generatedBuildListEntryId, v.wp!.k2!.searchIdentity, v.wp!.k2!.keySha256]
    const registered = new Set([D2E_K0_RESERVATION_DIGEST, D2E_K2_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest, D2E_B0_EXPECTED.inputDigest,
      D2E_B0_EXPECTED.resultDigest, D2F_K3_RESERVATION_DIGEST, D2F_NEW_SUPPORT_RESERVATION_DIGEST, D2F_WP_EXPECTED.inputDigest, D2F_WP_EXPECTED.resultDigest])
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|build-list\.(constrained\.)?fnv1a32|planner-alternative-search\.fnv1a32/)
      for (const id of ids) expect(source).not.toContain(id.replace(/^(build-list\.(constrained\.)?|planner-alternative-search\.)/, '').slice(0, 16))
      for (const m of source.matchAll(/fnv1a32:[0-9a-f]{8}/g)) expect(registered.has(m[0])).toBe(true)
    }
  })

  it('writes no resolution, lineage or selected Entry (G1 / G30) and keeps the Search to the one K3 context (G53 / G54)', () => {
    for (const source of [mainSource, analysisSource]) {
      expect(codeOnly(source)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|mergePlannerConflictScenarioResolution|selectedBuildListEntryId:\s*'/)
      expect(codeOnly(source)).not.toMatch(/runPlannerAlternativeKernel|K4-|K4_CONTEXT/)
    }
    // The K3 reservation is derived by the existing authority from the three support bodies, never a union of K1 / K2 bodies.
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, S\)/)
    expect(codeOnly(mainSource)).toMatch(/d2fPermutations\(S\)\.map\(order => \{\n\s*const r = phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, order\)/)
    expect(codeOnly(mainSource)).not.toMatch(/reservation = d2eReservationUnion|reservationBody: d2eReservationUnion/)
    expect(codeOnly(runnerSource)).not.toMatch(/'admit'|composition/)
    // One Search call site (the DSC unit), over the K3 context's prepared reservation only.
    expect([...codeOnly(mainSource).matchAll(/await visitPlannerAlternativeCandidates\(/g)]).toHaveLength(1)
  })

  it('is never imported by Production, changes no earlier Research module, and counts Production source changes by the registered rule', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2F/.test(source)).map(([path]) => path)).toEqual([])
    // Only the D2-F files themselves may import the D2-F modules, by exact path (never a `D2F` substring of the path: Phase
    // 2-C2.5-D2-F, `plannerGlobalPhase2C25D2F*`, would be another Research item, D2-F-A §11.4 / G61).
    const allowed = ['./plannerGlobalD2F.ts', './plannerGlobalD2FAnalysis.ts', './plannerGlobalD2F.test.ts']
    const D2F_IMPORT = /(?:from\s+|import\s*\(\s*)['"]\.\/plannerGlobalD2F(?:Analysis)?(?:\.ts)?(?:\?raw)?['"]/
    const illegal = (sources: Record<string, string>) => Object.entries(sources).filter(([path, source]) => !allowed.includes(path) && D2F_IMPORT.test(source)).map(([path]) => path)
    expect(illegal(benchmarkSources)).toEqual([])
    expect(allowed.filter(path => /Phase2C25D2F/.test(path))).toEqual([])
    for (const path of allowed.filter(x => x !== './plannerGlobalD2F.test.ts')) expect(benchmarkSources[path], path).toBeDefined()
    const phase2c25 = Object.keys(benchmarkSources).filter(path => /^\.\/plannerGlobalPhase2C25D2[DE]/.test(path))
    expect(phase2c25.length).toBeGreaterThan(0)
    for (const path of phase2c25) expect(illegal({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { runD2FEvaluation } from './plannerGlobalD2F'\n` })).toEqual([path])
    // The D2-F modules themselves never reach Phase 2-C2.5 (G61), and import the D2-E module unchanged (no D2-E module edit).
    for (const path of allowed.filter(x => x !== './plannerGlobalD2F.test.ts')) expect(benchmarkSources[path], path).not.toMatch(/from '\.\/plannerGlobalPhase2C25/)
    expect(d2fProductionChangedFiles(['src/benchmarks/plannerGlobalD2F.ts', 'scripts/run-planner-global-d2f.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d2fProductionChangedFiles(['src/domain/planner/x.ts'])).toEqual(['src/domain/planner/x.ts'])
  })

  it('builds the RV task (9 Candidates, 3 supports, RV7 new support, RV8 WP K2) and the evaluation tasks (S5 authorities incl. the new support) from V only', () => {
    const v = validateD2FInputs(realEvidence())
    const rv = d2fReverificationTask(v, projectD2FD2CResult(JSON.parse(d2cResultRaw), 't03')!.contexts)
    expect(rv.d2d.candidates.map(c => `${c.label}c${c.ordinal}`)).toEqual(['t00c1', 't01c1', 't04c1', 't05c1', 't06c3', 't07c3', 't08c1', 't09c1', 't10c1'])
    expect(rv.d2d.supports.map(s => s.contexts.map(c => c.k))).toEqual([[6], [3, 5], [1, 4, 7]])
    expect(rv.newSupport).toMatchObject({ supportBuildListEntryId: v.newSupport!.supportBuildListEntryId, registeredReservationDigest: D2F_NEW_SUPPORT_RESERVATION_DIGEST })
    expect(rv.wpCandidate).toMatchObject({ generatedEntrySha256: D2F_REGISTERED_INPUTS.d2eWpGeneratedEntry.sha256, contextReservationDigest: D2E_K2_RESERVATION_DIGEST })
    const ns: D2FSupportAuthority = { supportBuildListEntryId: v.newSupport!.supportBuildListEntryId, source: 'ctx_k3_single', k: null, contextId: v.k3!.contextId, supportBodySha256: v.newSupport!.supportBodySha256,
      reservationDigest: D2F_NEW_SUPPORT_RESERVATION_DIGEST, reservationBody: v.registeredNewSupportReservationBody! }
    const rep = (r: NonNullable<D2FValidatedInputs['i0']>['replacements'][number]) => ({ targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
      generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: r.requiresSupport, contextId: r.contextId,
      contextReservationDigest: null, contextReservation: null, searchReservationDigest: null })
    const i0Task = d2fEvaluationTask(v, 'I0', 'I0', null, v.i0!.replacements.map(rep), null)
    expect(i0Task.supportAuthorities.map(a => a.k)).toEqual([6, 3, 1])
    const extTask = d2fEvaluationTask(v, 'EXT', 'EXT', 1, [...v.i0!.replacements.map(rep), { ...rep(v.i0!.replacements[0]!), targetWeaponId: v.k3!.targetWeaponId, requiresSupport: v.k3!.supportBuildListEntryIds }], ns)
    expect(extTask.supportAuthorities.map(a => a.source)).toEqual(['k1_ctx_record', 'k1_ctx_record', 'k1_ctx_record', 'ctx_k3_single'])
    expect(extTask.supportAuthorities.map(a => a.supportBuildListEntryId).sort()).toEqual([...new Set([...v.i0!.requiresSupport, ...v.k3!.supportBuildListEntryIds])].sort())
    expect(extTask).toMatchObject({ stage: 'EXT', evaluatedAgainst: 'replacement_set', ordinal: 1, researchMaxPlanSteps: 20_000, fullRunCap: 8 })
  })

  it('writes every §13 required RESULT field in the analyzer', () => {
    for (const field of ['phase:', 'analyzedAt:', 'sources:', 'specDocument:', 'd2e:', 'wpGeneratedEntry:', 'contextRecord:', 'd2eA:', 'd2eB:', 'd2d:', 'attestation:', 'raw:', 'documents:', 'd2c:',
      'contextRecordsUsed:', 'd2:', 'incumbentGeneratedEntries:', 'phase2c2Result:', 'export:', 'd2f:', 'runDir:', 'rvRecord:', 'discoveryRecords:', 'generatedEntries:', 'records', 'provenance:', 'formal,',
      'measuredHead,', 'analysisHead,', 'measuredHeadIsAncestor,', 'runStatus,', 'benchmarkCodeSha256,', 'registeredPolicySha256,', 'calculationCodeChangedSinceMeasuredHead,', 'productionChangedFiles:',
      'toMeasuredHead:', 'toAnalysisHead:', 'startAttestation:', 'd2eMeasuredHead:', 'd2dMeasuredHead:', 'd2cMeasuredHead:', 'd2MeasuredHead:', 'D2F_PROVENANCE_FLAGS', 'd2eResultFieldsRead:',
      'd2dResultFieldsRead:', 'd2cResultFieldsRead:', 'd2ResultFieldsRead:', 'contextRecordFieldsRead:', 'k2ContextRecordFieldsRead:', 'd2eResultModified:', 'environment:', 'conditions:', 'k3Context:',
      'derivationRule:', 'registeredReservation:', 'registeredNewSupportReservation:', 'ladder:', 'k3PoolCap:', 'dedupRules:', 'deliveryCapPerUnit:', 'incumbent:', 'order:', 'i0Rule:', 'wrapperParityRule:',
      'evaluationProcedure:', 'admissionRule:', 'extensionRule:', 'r5Definition:', 'extensionDiagnostics:', 'gate:', 'betterRule:', 'improvedRule:', 'selectionOrder:', 'r6Definition:', 'rvChecks:',
      'contextChecks:', 'supportChecks:', 'supportExpiryCauses:', 'budgets:', 'executionEnvelope:', 'researchMaxPlanSteps:', 'evaluationFullRunCap:', 'decisionRule:', 'comparisonBaselines:', 'notRun:',
      'inputValidation:', 'derivedK3Context:', 'k2Supports:', 'extendedEvaluationId:', 'lostTargetWeaponIds:', 'addedSupport:', 'derivedI0:', 'derivedWp:', 'rv:', 'context:', 'discovery:', 'evaluations:',
      'parityChecks:', 'extensions:', 'comparison:', 'aggregates:', 'timing:', 'memory:', 'invalidReasons:', 'decision:']) {
      expect(analyzerSource).toContain(field)
    }
    for (const flag of ['oracleReadByRunner', 'oracleReadByChild', 'oracleReadByAnalyzer', 'populationManifestRead', 'd2eResultModified', 'priorEvidenceReusedAsResult', 'oracleGuidedTargetPopulation', 'searchScope',
      'k3ReservationDerivedFromSupportBodies', 'k1k2ReservationUnionUsedAsSemantics', 'd2eBestExtensionUsedAsIncumbent', 'productionSemanticsChanged']) expect(mainSource).toContain(`${flag}:`)
    const r = analyze(synthetic())
    expect(Object.keys(r).sort()).toEqual(['aggregates', 'comparison', 'context', 'decision', 'discovery', 'evaluations', 'extensions', 'invalidReasons', 'parityChecks', 'rv', 'unmeasured'])
    for (const k of ['newSupportSelectedExtensions', 'newSupportTargetRetainedExtensions', 'newSupportLostExtensions', 't03CompletedWithNewSupportRetainedWithoutNetGainExtensions', 'wrapperParity',
      'globalCompleteObservedUnderIncomplete', 'exceedsD2dObservedUnderIncomplete', 'setCoexistenceObservedUnderIncomplete', 'k3CandidateObservedUnderIncomplete']) expect(r.decision).toHaveProperty(k)
    for (const e of r.evaluations) for (const k of ['stage', 'ordinal', 'registeredInputDigest', 'inputDigestMatched', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'conflicts',
      'referenceDiff', 'baselineDiff', 'r1r4', 'r5', 'extension', 'gate', 'eligible', 'improved', 'improvementKind', 'supportChecksByEntry', 'setReservationCheck', 'r6', 'priorParity', 'inputDigest', 'resultDigest']) expect(e).toHaveProperty(k)
    const ext = r.evaluations.find(e => e.stage === 'EXT')!.extension as Json
    for (const k of ['newSupport', 'newSupportTargetRetained', 'k2FailureResourcesObserved', 'priorT03ResourcesObserved', 'outsideSetConflictsWithT03G', 't03Completion']) expect(ext).toHaveProperty(k)
    for (const k of ['singleSupportReservations', 'checks', 'diagnostics', 'newSupportBuildListEntryId']) expect(r.context).toHaveProperty(k)
    for (const k of ['newSupport', 'wpCandidate', 'candidates', 'supports']) expect(r.rv).toHaveProperty(k)
    for (const u of r.discovery.units) for (const d of u.deliveries as Json[]) for (const k of ['r0K3', 'r0K2', 'r0Split', 'matchedD2eK2Ordinal']) expect(d).toHaveProperty(k)
    expect(new Set(r.parityChecks.map(c => c.kind))).toEqual(new Set(['k1_context', 'determinism_prior', 'baseline', 'd2d_best', 'd2e_i0', 'registered_input', 'd2e_wrapper', 'k3_context_registered',
      'k1_new_support_registered', 'k2_context_prior']))
  })
})

// ---------------------------------------------------------------- start attestation (§11.2)

const DOCS = Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, D2E.sources.documents[k].sha256 as string]))
const observation = () => ({ createdAt: '2026-10-11T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d2f.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D2F_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])),
  observedDocuments: Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: 1, sha256: DOCS[k]! }])),
  observedGStoreFiles: Object.fromEntries(D2E_INCUMBENT_G_STORE_FILES.map(f => [d2eGStoreKey(f.label, f.ordinal), { bytes: f.bytes, sha256: f.sha256 }])),
  observedContextRecords: Object.fromEntries(D2E_CONTEXT_RECORDS.map(c => [String(c.k), { bytes: c.bytes, sha256: c.sha256 }])),
  exportFileName: D2F_REGISTERED_INPUTS.export.file, productionAudit: { baseMain: D2F_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 }, appliedExecutionEnvelope: { ...D2F_EXECUTION_ENVELOPE }, rngEngineVersion: 'production-rng:c5-e7',
  observedCalculationContext: { ...D2F_CALCULATION_CONTEXT }, smoke: null })
const expectation: Parameters<typeof verifyD2FStartAttestation>[1] = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  exportSha256: EXPORT_SHA, chainedDocuments: DOCS, firstChildStartedAt: '2026-10-11T00:00:01.000Z' }

describe('D2-F start attestation (§11.2)', () => {
  it('verifies a clean formal launch at the measurement HEAD and fails on any drift', () => {
    const verify = (patch: object, exp = expectation) => verifyD2FStartAttestation(JSON.parse(JSON.stringify({ ...d2fStartAttestationBody(observation()), ...patch })), exp)
    expect(verify({})).toEqual({ verified: true, issues: [] })
    expect(verify({ productionAudit: { baseMain: D2F_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { maxRung: 'L0', maxChildren: null, budgetMs: null, skipEvaluations: false } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ budgets: { ...D2F_BUDGETS, extensionEvaluationsMax: 3 } }).issues).toContain('budgets differs from the registered condition')
    expect(verify({ k3PoolCap: 3 }).issues).toContain('k3PoolCap differs from the registered condition')
    expect(verify({ ladder: [] }).issues).toContain('ladder differs from the registered condition')
    expect(verify({ appliedExecutionEnvelope: { ...D2F_EXECUTION_ENVELOPE, discoveryUnitBudgetMs: 7_200_000 } }).verified).toBe(false)
    expect(verify({ rngEngineVersion: 'production-rng:c5-e8' }).verified).toBe(false)
    expect(verify({ observedInputs: { ...observation().observedInputs, d2eContextRecord: null } }).issues).toContain('the observed d2eContextRecord is not the registered input')
    expect(verify({ observedGStoreFiles: {} }).verified).toBe(false)
    expect(verify({}, { ...expectation, repositoryHead: 'e'.repeat(40) }).issues).toContain('repositoryHead differs')
    expect(verify({}, { ...expectation, exportSha256: null }).issues).toContain('the observed export is not the registered input')
    expect(verify({}, { ...expectation, chainedDocuments: { ...DOCS, d1a: 'f'.repeat(64) } }).issues).toContain('the observed document d1a is not the chained document')
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-10T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
