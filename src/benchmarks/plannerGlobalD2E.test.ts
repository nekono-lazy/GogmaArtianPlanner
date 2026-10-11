import { beforeEach, describe, expect, it, vi } from 'vitest'
import d2dResultRaw from '../../docs/PLANNER_GLOBAL_D2D_RESULT.json?raw'
import d2cResultRaw from '../../docs/PLANNER_GLOBAL_D2C_RESULT.json?raw'
import d2ResultRaw from '../../docs/PLANNER_GLOBAL_D2_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import d2dDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md?raw'
import d2dbDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md?raw'
import d2eDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d2e.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d2e.mjs?raw'
import { idealBonuses } from '../test/fixtures/constrainedEnumeration'
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
import { belowPracticalBonuses } from '../test/fixtures/constrainedEnumeration'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId, TargetWeapon } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, d1ResultDigest } from './plannerGlobalD1'
import type { D2EvaluationFacts } from './plannerGlobalD2'
import { runD2CEvaluation } from './plannerGlobalD2C'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import mainSource from './plannerGlobalD2E.ts?raw'
import analysisSource from './plannerGlobalD2EAnalysis.ts?raw'
import {
  compareD2ESelection,
  d2eContextId,
  d2eDiscoveryNext,
  d2eDiscoveryOutcome,
  d2eEvaluationTask,
  d2eGStoreKey,
  d2eImprovementKind,
  d2eProductionChangedFiles,
  d2eRegisteredConditions,
  d2eRegisteredPolicySha256,
  d2eReservationContains,
  d2eReservationUnion,
  d2eReverificationTask,
  d2eRungExtent,
  d2eStartAttestationBody,
  deriveD2EK2Contexts,
  parseD2ESpecIncumbentTable,
  parseD2ESpecK2Context,
  parseD2ESpecRegisteredReservation,
  parseD2ESpecT03ResourceIdentities,
  prepareD2EContextRecord,
  projectD2ED2CResult,
  projectD2ED2DResult,
  projectD2ED2Result,
  readD2EContextRecord,
  readD2EK2ContextRecord,
  runD2EDiscoveryUnit,
  runD2EEvaluation,
  validateD2EInputs,
  verifyD2EStartAttestation,
  D2E_B0_EXPECTED,
  D2E_BASE_MAIN,
  D2E_BUDGETS,
  D2E_CALCULATION_CONTEXT,
  D2E_CHAINED_DOCUMENT_KEYS,
  D2E_CONTEXT_RECORDS,
  D2E_EXECUTION_ENVELOPE,
  D2E_I0_EXPECTED,
  D2E_INCUMBENT_G_STORE_FILES,
  D2E_K0_RESERVATION_DIGEST,
  D2E_K2_RESERVATION_DIGEST,
  D2E_ORIGIN_DIGEST,
  D2E_REGISTERED_INPUTS,
  type D2EContextTask,
  type D2EDiscoveryTask,
  type D2EEvaluationTask,
  type D2EInputEvidence,
  type D2EReplacementTask,
  type D2EValidatedInputs,
} from './plannerGlobalD2E'
import { analyzeD2ERun, classifyD2EDecision, recomputeD2EK2ContextC3, type D2EAnalysisInput, type D2EDecisionInput, type D2EDiscoveryRow, type D2EEvaluationRow } from './plannerGlobalD2EAnalysis'

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

const D2D = JSON.parse(d2dResultRaw)
const D2C = JSON.parse(d2cResultRaw)
/** The chained Export SHA-256 (never written in a Research source). */
const EXPORT_SHA = D2D.sources.export.sha256 as string
const SPEC = lf(d2eDocument)
const d2cContexts = () => projectD2ED2CResult(JSON.parse(d2cResultRaw))!.contexts

/** The real committed RESULTs plus G store / CTX record / Export stand-ins rebuilt from them (their ids, Targets and reservation bodies). */
function realEvidence(): D2EInputEvidence {
  const files = Object.fromEntries(Object.entries(D2E_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])) as D2EInputEvidence['files']
  const documents = Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: D2D.sources.documents[k].bytes, sha256: D2D.sources.documents[k].sha256 }]))
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
  const supports = [...new Set((D2C.contexts as Json[]).map(c => c.supportBuildListEntryId as string))]
  const exportBuildListEntries = supports.map((id, i) => ({ id, targetWeaponId: `target.outside.${i}` }))
  return { files, documents, gStoreFiles, contextRecords, d2dResult: JSON.parse(d2dResultRaw), d2cResult: JSON.parse(d2cResultRaw), d2Result: JSON.parse(d2ResultRaw),
    phase2c2Result: JSON.parse(phase2c2ResultRaw), exportBuildListEntries, specMarkdown: SPEC }
}

describe('D2-E registered conditions', () => {
  it('registers the committed inputs by their SHA-256 and every value the D2-E document names', async () => {
    expect(await sha256(d2dResultRaw)).toBe(D2E_REGISTERED_INPUTS.d2dResult.sha256)
    expect(await sha256(d2cResultRaw)).toBe(D2E_REGISTERED_INPUTS.d2cResult.sha256)
    expect(await sha256(d2ResultRaw)).toBe(D2E_REGISTERED_INPUTS.d2Result.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D2E_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(lf(d2dDocument))).toBe(D2E_REGISTERED_INPUTS.d2dSpecDocument.sha256)
    expect(await sha256(lf(d2dbDocument))).toBe(D2E_REGISTERED_INPUTS.d2dbDocument.sha256)
    for (const v of Object.values(D2E_REGISTERED_INPUTS)) expect(SPEC).toContain(v.sha256 ?? EXPORT_SHA)
    expect(D2E_REGISTERED_INPUTS.export.sha256).toBeNull()
    for (const f of D2E_INCUMBENT_G_STORE_FILES) { expect(SPEC).toContain(f.sha256); expect(SPEC).toContain(`${f.runDir}/${f.file}`) }
    for (const c of D2E_CONTEXT_RECORDS) expect(SPEC).toContain(c.sha256)
    for (const d of [D2E_K0_RESERVATION_DIGEST, D2E_K2_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest, D2E_B0_EXPECTED.inputDigest, D2E_B0_EXPECTED.resultDigest]) expect(SPEC).toContain(d)
    expect(D2E_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
    const body = parseD2ESpecRegisteredReservation(SPEC)!
    expect(hashStableValue(body)).toBe(D2E_K2_RESERVATION_DIGEST)
  })

  it('fixes the budgets, the envelope, the ladder and the order as D2-E-A registers them', () => {
    expect(D2E_BUDGETS).toEqual({ contexts: 1, supportPerContext: 2, contextChildren: 1, discoveryUnitsMax: 3, k2PoolCap: 2, uniqueCandidatesMax: 2, deliveriesPerUnitMax: 9, generatedEntryFilesMax: 2,
      rvChildren: 1, b0Evaluations: 1, i0Evaluations: 1, admissionEvaluationsMax: 2, extensionEvaluationsMax: 2, evaluationRequestsMax: 6, childProcessesMax: 11, evaluationFullRunCap: 8,
      fullPlannerRunsMax: 48, researchMaxPlanSteps: 20_000 })
    expect(D2E_EXECUTION_ENVELOPE).toEqual({ rvBudgetMs: 600_000, contextUnitBudgetMs: 600_000, discoveryUnitBudgetMs: 3_600_000, evaluationBudgetMs: 1_800_000, discoveryEnvelopeMs: 14_400_000,
      runBudgetMs: 25_200_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none', memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D2E_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(SPEC).toMatch(/評価リクエスト合計 \| B0 1 \+ I0 1 \+ ADM ≤ 2 \+ EXT ≤ 2 = \*\*6以下\*\*/)
    expect(SPEC).toMatch(/child process合計 \| RV 1 \+ CTX 1 \+ DSC ≤ 3 \+ 評価 ≤ 6 = \*\*11以下\*\*/)
    expect(SPEC).toContain('V      入力検証')
    const c = d2eRegisteredConditions()
    expect(c.ladder).toEqual([{ id: 'L0', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 } }, { id: 'L1', extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 } },
      { id: 'L2', extent: { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } }])
    expect(c.order).toEqual(['V', 'RV', 'B0', 'I0', 'CTX-K2', 'DSC L0 -> L1 -> L2', 'ADM (discovery ordinal)', 'EXT (discovery ordinal, admitted only)'])
    expect(c.selectionOrder).toEqual(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
    expect(c.decisionRule.map(r => r.split(':')[0])).toEqual(['D2E_INVALID', 'D2E_INCOMPLETE', 'D2E_GLOBAL_COMPLETE_R', 'D2E_EXCEEDS_D2D_BEST', 'D2E_SET_COEXISTENT_NOT_BETTER', 'D2E_NO_SET_COEXISTENCE',
      'D2E_NO_ADMITTED_K2_CANDIDATE', 'D2E_NO_K2_CANDIDATE'])
    expect(c.k2PoolCap).toBe(2)
    expect(c.deliveryCapPerUnit).toBe(9)
    expect(d2eRegisteredPolicySha256(syncSha)).toBe(d2eRegisteredPolicySha256(syncSha))
  })

  it('reads only the allowlisted D2-D / D2-C / D2 RESULT and CTX record fields', () => {
    const d2d = projectD2ED2DResult(JSON.parse(d2dResultRaw))!
    expect(d2d.evaluations.map(e => e.evaluationId).sort()).toEqual(['B0', 'I0', 'PAIR-t05c1-t07c3'])
    expect(d2d.conditions.fixedCandidates).toHaveLength(7)
    expect(d2d.derivedPair).toMatchObject({ evaluationId: 'PAIR-t05c1-t07c3', t05Ordinal: 1, t07Ordinal: 3, inputDigest: D2E_I0_EXPECTED.inputDigest })
    expect(JSON.stringify(d2d.evaluations)).not.toMatch(/routeCommitment|referenceDiff|bodyExpected/)
    const d2c = projectD2ED2CResult(JSON.parse(d2cResultRaw))!
    expect(d2c.notEligibleLabels).toEqual(['t03', 't05'])
    expect(d2c.poolTargets.map(t => t.label)).toEqual(['t03'])
    expect(d2c.observations.map(e => e.evaluationId).sort()).toEqual(['ADM-t03-c1', 'ADM-t03-c2', 'ADM-t03-c3', 'ADM-t03-c4', 'ADM-t05-c1', 'ADM-t05-c2', 'CMP-t03-c1', 'CMP-t03-c2',
      'CMP-t03-c3', 'CMP-t03-c4', 'CMP-t05-c1', 'CMP-t05-c2'])
    expect(JSON.stringify(d2c.contexts)).not.toMatch(/reservationBody|checks/)
    const d2 = projectD2ED2Result(JSON.parse(d2ResultRaw), ['t03'])!
    expect(d2.targets).toHaveLength(11)
    expect(Object.keys(d2.pools)).toEqual(['t03'])
    const ctx = readD2EContextRecord({ result: { status: 'context_ready', contextId: 'c', supportBuildListEntryId: 's', supportBodySha256: 'b', reservationBody: { a: 1 }, reservationDigest: 'd', originDigest: 'o',
      excludedRouteKeys: [], excludedRouteKeySha256s: [], checks: { secret: 1 } } })
    expect(Object.keys(ctx.record!).sort()).toEqual(['contextId', 'excludedRouteKeySha256s', 'excludedRouteKeys', 'originDigest', 'reservationBody', 'reservationDigest', 'status', 'supportBodySha256', 'supportBuildListEntryId'])
    expect(readD2EContextRecord({ result: { status: 'context_ready', reservationBody: '{"a":1}', reservationDigest: 'd', supportBodySha256: 'b', originDigest: 'o', excludedRouteKeys: [] } }).issue).toMatch(/not a JSON object/)
    expect(readD2EK2ContextRecord({ result: { status: 'context_ready', reservationBody: '{}', reservationDigest: 'd', supportBodySha256s: {}, originDigest: 'o', excludedRouteKeys: [], checks: {} } }).issue).toMatch(/not a JSON object/)
  })
})

// ---------------------------------------------------------------- V, the §3.1 K2 derivation and the §6.1 I0 derivation

describe('D2-E V: the K2 context and the I0 set re-derived from the RESULTs (§3.1 / §3.2 / §6.1 / §10.1)', () => {
  it('derives exactly the §3.2 K2 context and the §1.2 I0 set with inputDigest fnv1a32:6493291d', () => {
    const v = validateD2EInputs(realEvidence())
    expect(v.issues).toEqual([])
    expect(v.passed).toBe(true)
    const table = parseD2ESpecK2Context(SPEC)!
    expect(v.k2).toMatchObject({ contextId: table.contextId, label: 't03', targetWeaponId: table.targetWeaponId, currentBuildListEntryId: table.currentBuildListEntryId,
      supportBuildListEntryIds: table.supportBuildListEntryIds, admObserved: 4, cmpObserved: 4, crossSupportLossAll: true })
    expect(v.k2!.contextId).toBe(d2eContextId('t03', table.supportBuildListEntryIds))
    expect(v.k2!.k1Contexts.map(c => c.k)).toEqual([3, 4])
    expect(v.k2Derivation!.notEligibleLabels).toEqual(['t03', 't05'])
    expect(v.i0!.inputDigest).toBe(D2E_I0_EXPECTED.inputDigest)
    expect(v.i0!.replacements.map(r => `${r.label}c${r.ordinal}`)).toEqual(parseD2ESpecIncumbentTable(SPEC).map(r => `${r.label}c${r.ordinal}`))
    expect(v.i0!.requiresSupport).toHaveLength(3)
    expect(v.supports.map(s => s.contexts.map(c => c.k))).toEqual([[6], [3, 5], [1, 4, 7]])
    expect(v.d2bK0Pool).toHaveLength(3)
    expect(v.d2cK1Pool).toHaveLength(4)
    expect(v.d2cT03ResourceIdentities).toEqual(parseD2ESpecT03ResourceIdentities(SPEC))
    expect(v.d2cT03ResourceIdentities).toHaveLength(4)
    expect(v.priorByInputDigest[D2E_B0_EXPECTED.inputDigest]!.map(x => `${x.source}:${x.evaluationId}`).sort()).toEqual(['D2-C:B0', 'D2-D:B0', 'D2:B0'])
    expect(v.priorByInputDigest[D2E_I0_EXPECTED.inputDigest]!.map(x => `${x.source}:${x.evaluationId}`)).toEqual(['D2-D:PAIR-t05c1-t07c3'])
    expect(v.expected?.i0).toMatchObject({ completed: 24, conflicts: 19, steps: 1465, resourceConflictRejections: 19 })
    expect(v.expected!.i0.supportsSelected).toHaveLength(3)
  })

  const failing = (mutate: (e: D2EInputEvidence) => void) => {
    const e = realEvidence()
    mutate(e)
    const v = validateD2EInputs(e)
    expect(v.passed).toBe(false)
    return v.issues.join(';')
  }

  it('fails closed on a missing file, a digest / byte mismatch or a changed RESULT, never substituting a value', () => {
    expect(failing(e => { e.files.d2dAttestation = null })).toMatch(/d2dAttestation: .* is missing/)
    expect(failing(e => { e.files.d2dResult = { bytes: 402_549, sha256: '0'.repeat(64) } })).toMatch(/d2dResult: SHA-256/)
    expect(failing(e => { e.files.export = { bytes: 1, sha256: EXPORT_SHA } })).toMatch(/export: 1 bytes/)
    expect(failing(e => { (e.d2dResult as { decision: { case: string } }).decision.case = 'D2D_INCOMPLETE' })).toMatch(/decision.case is not D2D_EXCEEDS_D2C_FINAL/)
    expect(failing(e => { (e.d2dResult as { decision: { bestImprovedPair: string } }).decision.bestImprovedPair = 'PAIR-t05c2-t07c3' })).toMatch(/bestImprovedPair/)
    expect(failing(e => { (e.d2cResult as { decision: { case: string } }).decision.case = 'D2C_INCOMPLETE' })).toMatch(/D2-C RESULT decision.case/)
    expect(failing(e => { e.documents.d1a = { bytes: 1, sha256: '1'.repeat(64) } })).toMatch(/not the document D2-D RESULT sources.documents names/)
    expect(failing(e => { e.gStoreFiles['t07-c3'] = null })).toMatch(/t07-c3.generated-entry.json: the G store file is missing/)
    expect(failing(e => { e.contextRecords[3]!.file = { bytes: 98_825, sha256: '2'.repeat(64) } })).toMatch(/CTX-3.context.json: the CTX record is not the registered one/)
    expect(failing(e => { const r = (e.contextRecords[4]!.json as { result: Json }).result; r.reservationBody = stableStringify(r.reservationBody) })).toMatch(/CTX-4.context.json: .*not a JSON object/)
  })

  it('fails closed when the §3.1 derivation is not the §3.2 table (support, order, observation, R1)', () => {
    // The registered support order / ID changed in the attested text.
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| support（Entry ID昇順） | `build-list.fnv1a32-92d87b90`', '| support（Entry ID昇順） | `build-list.fnv1a32-92d87b91`') }))
      .toMatch(/the §3.1 derivation is not the §3.2 table/)
    // A D2-C ADM R1 false: no K2 Target is derived.
    expect(failing(e => { ((e.d2cResult as { evaluations: Json[] }).evaluations.find(x => x.evaluationId === 'ADM-t03-c2')!.r1r4 as Json).R1 = false })).toMatch(/yields 0 K2 contexts/)
    // A selected D2-C t03 Candidate (no cross-support loss).
    expect(failing(e => { ((e.d2cResult as { evaluations: Json[] }).evaluations.find(x => x.evaluationId === 'CMP-t03-c3')!.candidates as Json[]).find(c => c.label === 't03')!.selected = true })).toMatch(/yields 0 K2 contexts/)
    // An unevaluated observation is a V failure, never skipped.
    expect(failing(e => { (e.d2cResult as { evaluations: Json[] }).evaluations.find(x => x.evaluationId === 'CMP-t03-c1')!.status = 'timeout' })).toMatch(/CMP-t03-c1: not evaluated/)
    // A changed I0 G in the §1.2 table.
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('`build-list.constrained.fnv1a32-174be6b1`', '`build-list.constrained.fnv1a32-174be6b2`') })).toMatch(/the §6.1 derivation is not the §1.2 table/)
  })

  it('derives K2 mechanically: t05 (one K1 context) is not a K2 Target, the supports come from the contexts', () => {
    const d2c = projectD2ED2CResult(JSON.parse(d2cResultRaw))!
    const d = deriveD2EK2Contexts(d2c)
    expect(d.contexts.map(c => c.label)).toEqual(['t03'])
    // Reordering the contexts keeps the Entry ID order of the supports.
    d2c.contexts.reverse()
    expect(deriveD2EK2Contexts(d2c).contexts[0]!.supportBuildListEntryIds).toEqual(d.contexts[0]!.supportBuildListEntryIds)
  })

  it('checks the K2 body against the K1 bodies componentwise and records the union only as a diagnostic', () => {
    const ctx = (D2C.contexts as Json[])
    const k1 = [3, 4].map(k => ctx.find(c => c.k === k)!.reservationBody as Json)
    const k2 = parseD2ESpecRegisteredReservation(SPEC)!
    expect(k1.every(b => d2eReservationContains(k2, b))).toBe(true)
    expect(d2eReservationContains(k1[0]!, k2)).toBe(false)
    expect(stableStringify(d2eReservationUnion(k1))).toBe(stableStringify(k2))
    expect(d2eReservationContains({ ...k2, exclusiveOwnedWeaponIds: [] }, k1[0]!)).toBe(false)
  })
})

// ---------------------------------------------------------------- CTX-K2, DSC and the evaluation child on the Fake RNG Engine fixture

const TARGET_A = 'target.d2e.a', TARGET_B = 'target.d2e.b', TARGET_C = 'target.d2e.c'
const ENTRY_A = 'build-list.d2e.a' as BuildListEntryId, ENTRY_B = 'build-list.d2e.b' as BuildListEntryId, ENTRY_C = 'build-list.d2e.c' as BuildListEntryId
const SOURCE_C = 'owned.d2e.c'
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source', SKILL_C = 'series_skill.fixture.s9'

/** Support A resets Gogma 10, support C resets Skills at 9, the Target B Entry mixes Reset Bonuses 10 + Reset Skills 7. */
function fixture(): OrchestrationScenario {
  const skill = { seriesSkillId: SKILL_A, groupSkillId: null, matchMode: 'all' as const }
  const skillC = { seriesSkillId: SKILL_C, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const c: TargetWeapon = orchestrationTarget(TARGET_C, { priority: 4, idealSkillCondition: skillC, practicalSkillCondition: skillC })
  const ownedWeapons = [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }), orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B }),
    orchestrationSource(SOURCE_C, { restorationBonuses: idealBonuses(), seriesSkillId: SKILL_B })]
  const entries = [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    orchestrationEntry(ENTRY_C, c, resetSkillsRoute(SOURCE_C, 9), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_C })]
  return orchestrationScenario({ targets: [a, b, c], ownedWeapons, entries, engine: { gogmaPositions: 260, skillPositions: 12 } })
}
const research = (built: OrchestrationScenario) => ({ ...built.input, options: { maxPlanSteps: 20_000 } })
const E1 = [TARGET_B, ...Array.from({ length: 10 }, (_, i) => `target.e1.${i}`)]
const E1_O = [ENTRY_B, ...Array.from({ length: 10 }, (_, i) => `build-list.e1.${i}`)]
const S = [ENTRY_A, ENTRY_C].sort()

function k1Context(built: OrchestrationScenario, support: string, k: number) {
  const input = research(built)
  const body = input.buildListEntries.find(e => e.id === support)!
  const reservation = derivePlannerAlternativeReservation([body], built.dependencies.rngEngine)
  const schedule = derivePhase2C26B2C1Schedule(input, built.dependencies)
  const own = input.buildListEntries.find(e => e.id === ENTRY_B)!
  return { supportBuildListEntryId: support, k, recordSha256: `r${k}`, reservationBody: structuredClone(reservation) as unknown as Json, reservationDigest: hashStableValue(reservation),
    originDigest: schedule.snapshot.originDigest, excludedRouteKeySha256s: [syncSha(candidateStableKey(own.candidateSnapshot))], supportBodySha256: syncSha(stableStringify(body)) }
}
function contextTask(built: OrchestrationScenario, registered?: { digest: string; body: Json }): D2EContextTask {
  const input = research(built)
  const k2 = derivePlannerAlternativeReservation(S.map(id => input.buildListEntries.find(e => e.id === id)!), built.dependencies.rngEngine)
  return { unitId: 'CTX-K2', contextId: d2eContextId('t03', S), label: 't03', targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, supportBuildListEntryIds: S, e1TargetWeaponIds: E1,
    e1CurrentBuildListEntryIds: E1_O, registeredReservationDigest: registered?.digest ?? hashStableValue(k2), registeredReservationBody: registered?.body ?? structuredClone(k2) as unknown as Json,
    k1Contexts: [k1Context(built, ENTRY_A, 3), k1Context(built, ENTRY_C, 4)].sort((x, y) => x.supportBuildListEntryId < y.supportBuildListEntryId ? -1 : 1), researchMaxPlanSteps: 20_000 }
}
function contextOf(built: OrchestrationScenario, task = contextTask(built)) {
  const input = research(built)
  return JSON.parse(JSON.stringify(prepareD2EContextRecord(input, derivePhase2C26B2C1Schedule(input, built.dependencies), input.buildListEntries, task, built.dependencies, syncSha)))
}
function discoveryTask(built: OrchestrationScenario, ctx: Json, over: Partial<D2EDiscoveryTask> = {}): D2EDiscoveryTask {
  const task = contextTask(built)
  return { unitId: 'DSC-K2-L0', contextId: d2eContextId('t03', S), label: 't03', targetWeaponId: TARGET_B, supportBuildListEntryIds: S, currentBuildListEntryId: ENTRY_B, rung: 'L0', extent: d2eRungExtent('L0'),
    context: { recordSha256: 'r', reservationBody: ctx.reservationBody as Json, reservationDigest: ctx.reservationDigest as string, originDigest: ctx.originDigest as string, excludedRouteKeys: ctx.excludedRouteKeys as string[] },
    k1Reservations: task.k1Contexts.map(k => ({ supportBuildListEntryId: k.supportBuildListEntryId, k: k.k, reservationBody: k.reservationBody })), poolKeysAtStart: [], d2bK0Pool: [], d2cK1Pool: [],
    poolCap: 2, researchMaxPlanSteps: 20_000, ...over }
}

describe('D2-E CTX-K2 (§4.1): C1 .. C7 from Production parts, no Search, no full run', () => {
  it('derives the two-support reservation from the support bodies (never a K1 union), order-invariant, containing each K1 body', () => {
    const built = fixture()
    const ctx = contextOf(built)
    expect(ctx.issues).toEqual([])
    expect(ctx.status).toBe('context_ready')
    expect(ctx.checks.C1.satisfied && ctx.checks.C2.satisfied && ctx.checks.C3.satisfied && ctx.checks.C4.satisfied && ctx.checks.C6.satisfied && ctx.checks.C7.satisfied).toBe(true)
    expect(ctx.checks.C5).toMatchObject({ state: 'matched', digestMatched: true, bodyMatched: true })
    expect(ctx.supportBuildListEntryIds).toEqual(S)
    expect(typeof ctx.reservationBody).toBe('object')
    expect(ctx.reservationDigest).toBe(hashStableValue(ctx.reservationBody))
    expect(ctx.diagnostics.equalsK1ComponentwiseUnion).not.toBeNull()
    expect(Object.keys(ctx.diagnostics.k1Reservations).sort()).toEqual(S)
    expect(preflightSpy.calls).toEqual([])
  })

  it('records the exclusively consumed OwnedWeapon of the support Routes, and the analyzer recomputes C3 independently of the record', () => {
    const built = fixture()
    const ctx = contextOf(built)
    const exportEntries = research(built).buildListEntries
    // Support A Resets Bonuses on SOURCE_A (consumed); support C Resets Skills on SOURCE_C (referenced, not consumed).
    expect(ctx.checks.C3.exclusiveConsumedOwnedWeaponIds).toEqual([ORCHESTRATION_SOURCE_A])
    expect(ctx.checks.C3.referencedOwnedWeaponIds).toEqual([ORCHESTRATION_SOURCE_A, SOURCE_C].sort())
    const c3 = (over: { recordC3?: Json; exportBuildListEntries?: readonly unknown[]; reservationBody?: unknown; rngEngine?: null; recordSupportBuildListEntryIds?: string[] } = {}) => recomputeD2EK2ContextC3({
      recordSupportBuildListEntryIds: over.recordSupportBuildListEntryIds ?? ctx.supportBuildListEntryIds, registeredSupportBuildListEntryIds: S, exportBuildListEntries: over.exportBuildListEntries ?? exportEntries,
      reservationBody: over.reservationBody ?? ctx.reservationBody, recordC3: (over.recordC3 ?? ctx.checks.C3) as never, rngEngine: over.rngEngine === null ? null : built.dependencies.rngEngine })
    const ok = c3()
    expect(ok).toMatchObject({ satisfied: true, issues: [], exclusiveConsumedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A], referencedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A, SOURCE_C].sort(),
      routeUnitPlannedEntries: 2, routeUnitRejections: 0, recordMatched: { referenced: true, consumed: true, exclusive: true } })
    expect([...ok.referencedOwnedWeaponIds, ...ok.exclusiveConsumedOwnedWeaponIds].every(id => ok.exclusiveOwnedWeaponIds.includes(id))).toBe(true)
    const record = (patch: Json) => ({ ...ctx.checks.C3, ...patch })
    // A tampered record never passes: one consumed ID dropped, a non-existent ID added, the ID replaced.
    expect(c3({ recordC3: record({ exclusiveConsumedOwnedWeaponIds: [] }) })).toMatchObject({ satisfied: false, recordMatched: { consumed: false } })
    expect(c3({ recordC3: record({ exclusiveConsumedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A, 'owned.not.existing'] }) })).toMatchObject({ satisfied: false, recordMatched: { consumed: false } })
    expect(c3({ recordC3: record({ exclusiveConsumedOwnedWeaponIds: [ORCHESTRATION_SOURCE_B] }) })).toMatchObject({ satisfied: false, recordMatched: { consumed: false } })
    expect(c3({ recordC3: record({ referencedOwnedWeaponIds: [ORCHESTRATION_SOURCE_A] }) })).toMatchObject({ satisfied: false, recordMatched: { referenced: false } })
    // Route unit planning rejects a support Route whose saved Counter does not advance as the Engine does.
    const rejected = exportEntries.map(e => e.id !== ENTRY_A ? e : { ...e, candidateSnapshot: { ...e.candidateSnapshot, route: { ...e.candidateSnapshot.route,
      operations: e.candidateSnapshot.route.operations.map(op => ({ ...op, gogmaCounterAfter: 13 })) } } })
    const r = c3({ exportBuildListEntries: rejected })
    expect(r.satisfied).toBe(false)
    expect(r.routeUnitRejections).toBe(1)
    expect(r.issues.join(';')).toMatch(/route unit planning rejected 1 support Entry/)
    // The reservation exclusive set lacking a required ID, a missing Engine, foreign supports, a missing body.
    expect(c3({ reservationBody: { ...(ctx.reservationBody as Json), exclusiveOwnedWeaponIds: [SOURCE_C] } }).issues.join(';')).toMatch(new RegExp(`lacks ${ORCHESTRATION_SOURCE_A.replace(/\./g, '\\.')}`))
    expect(c3({ rngEngine: null })).toMatchObject({ satisfied: false, issues: expect.arrayContaining(['no RNG Engine to recompute the route unit plans']) })
    expect(c3({ recordSupportBuildListEntryIds: [ENTRY_A, ENTRY_B].sort() }).satisfied).toBe(false)
    expect(c3({ exportBuildListEntries: exportEntries.filter(e => e.id !== ENTRY_C) }).issues.join(';')).toMatch(/0 Export Entries hold/)
  })

  it('records C5 mismatched against another registered body and fails C1 / C6 closed', () => {
    const built = fixture()
    const registered = { digest: 'fnv1a32:00000000', body: { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] } }
    const mismatched = contextOf(built, contextTask(built, registered))
    expect(mismatched.checks.C5).toMatchObject({ state: 'mismatched', digestMatched: false, bodyMatched: false })
    // A support inside E1 fails C1; a K1 body the K2 body does not contain fails C6.
    const inE1 = contextOf(built, { ...contextTask(built), e1TargetWeaponIds: [TARGET_A, ...E1.slice(1)].map((x, i) => i === 1 ? TARGET_B : x) })
    expect(inE1.checks.C1.satisfied).toBe(false)
    expect(inE1.status).toBe('guardrail_violation')
    const task = contextTask(built)
    const wider = contextOf(built, { ...task, k1Contexts: task.k1Contexts.map((k, i) => i === 0 ? { ...k, reservationBody: { ...k.reservationBody, exclusiveOwnedWeaponIds: ['owned.other'] } } : k) })
    expect(wider.checks.C6.satisfied).toBe(false)
    expect(wider.status).toBe('guardrail_violation')
    const oneSupport = contextOf(built, { ...task, supportBuildListEntryIds: [S[0]!], contextId: d2eContextId('t03', [S[0]!]) })
    expect(oneSupport.checks.C1.satisfied).toBe(false)
  })
})

describe('D2-E DSC (§4.2 - §4.6): R0-K2 / R0-split, D-1 .. D-5, the rung progression', () => {
  it('pools at most two K2 Candidates that respect the K2 and both K1 reservations, never materializing a known key', async () => {
    const built = fixture()
    const ctx = contextOf(built)
    const unit = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx), built.dependencies, { sha256OfText: syncSha })
    if (unit.status === 'guardrail_violation' || unit.status === 'discovery_calculation_error') throw new Error(JSON.stringify(unit))
    expect(unit.deliveries.every(d => d.r0K2 && Object.values(d.r0Split).every(Boolean))).toBe(true)
    expect(unit.pooled.length).toBeLessThanOrEqual(2)
    for (const p of unit.pooled) {
      expect(p.requiresSupport).toEqual(S)
      expect(p.reservationDigest).toBe(ctx.reservationDigest)
      expect(p.replacement).toEqual({ status: 'ready', replacedBuildListEntryId: ENTRY_B })
      expect(Object.keys(p.r0Split).sort()).toEqual(S)
    }
    expect(preflightSpy.calls).toEqual([])
    expect(unit.pooled.length).toBeGreaterThan(0)
    // D-2 / D-4 / D-5: the same keys are classified, never pooled again.
    const keys = unit.pooled.map(p => p.candidateStableKey)
    const dup = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { poolKeysAtStart: [keys[0]!] }), built.dependencies, { sha256OfText: syncSha })
    if (dup.status === 'guardrail_violation' || dup.status === 'discovery_calculation_error') throw new Error(JSON.stringify(dup))
    expect(dup.deliveries.find(d => d.candidateStableKey === keys[0])?.action).toBe('duplicate_of_lower_rung')
    const d4 = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { d2bK0Pool: [{ ordinal: 2, keySha256: syncSha(keys[0]!) }] }), built.dependencies, { sha256OfText: syncSha })
    if (d4.status === 'guardrail_violation' || d4.status === 'discovery_calculation_error') throw new Error(JSON.stringify(d4))
    expect(d4.deliveries.find(d => d.candidateStableKey === keys[0])).toMatchObject({ action: 'same_key_as_d2b_k0_pool', matchedD2bOrdinal: 2, matchedD2cK1: null })
    const d5 = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { d2cK1Pool: [{ ordinal: 3, contextId: 'K1-t03-x', keySha256: syncSha(keys[0]!) }] }), built.dependencies, { sha256OfText: syncSha })
    if (d5.status === 'guardrail_violation' || d5.status === 'discovery_calculation_error') throw new Error(JSON.stringify(d5))
    expect(d5.deliveries.find(d => d.candidateStableKey === keys[0])).toMatchObject({ action: 'same_key_as_d2c_k1_pool', matchedD2cK1: { ordinal: 3, contextId: 'K1-t03-x' } })
  })

  it('stops on context drift, a non-registered extent or an R0-split violation (guardrail)', async () => {
    const built = fixture()
    const ctx = contextOf(built)
    const drift = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { context: { ...discoveryTask(built, ctx).context, reservationDigest: 'fnv1a32:00000000' } }), built.dependencies, { sha256OfText: syncSha })
    expect(drift).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^context_drift: /)] })
    const extent = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { extent: d2eRungExtent('L2') }), built.dependencies, { sha256OfText: syncSha })
    expect(extent).toMatchObject({ status: 'guardrail_violation' })
    const oneSplit = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx, { k1Reservations: discoveryTask(built, ctx).k1Reservations.slice(0, 1) }), built.dependencies, { sha256OfText: syncSha })
    expect(oneSplit).toMatchObject({ status: 'guardrail_violation' })
  })

  it('escalates only after an extent bound with a pool below 2, and stops on cap / exhaustion / unmeasured', () => {
    expect(d2eDiscoveryNext('stopped_by_search_extent_bound', 'L0', 0)).toEqual({ next: 'L1', stop: null })
    expect(d2eDiscoveryNext('stopped_by_search_extent_bound', 'L1', 1)).toEqual({ next: 'L2', stop: null })
    expect(d2eDiscoveryNext('ladder_exhausted', 'L2', 0)).toEqual({ next: null, stop: 'ladder_exhausted' })
    expect(d2eDiscoveryNext('discovery_cap_reached', 'L0', 2)).toEqual({ next: null, stop: 'discovery_cap_reached' })
    expect(d2eDiscoveryNext('discovery_exhausted', 'L1', 1)).toEqual({ next: null, stop: 'discovery_exhausted' })
    expect(d2eDiscoveryNext('timeout', 'L1', 0)).toEqual({ next: null, stop: 'unmeasured' })
    expect(d2eDiscoveryNext('not_executed', 'L1', 0)).toEqual({ next: null, stop: 'not_executed' })
    expect(() => d2eDiscoveryNext('stopped_by_search_extent_bound', 'L1', 2)).toThrow(/full pool/)
    expect([d2eDiscoveryOutcome('discovery_cap_reached'), d2eDiscoveryOutcome('ladder_exhausted'), d2eDiscoveryOutcome('discovery_exhausted'), d2eDiscoveryOutcome('unmeasured'), d2eDiscoveryOutcome(null)])
      .toEqual(['cap_reached', 'ladder_exhausted', 'discovery_exhausted', 'unmeasured', 'unmeasured'])
  })
})

describe('D2-E evaluations (§5 / §6 / §7.2): the runD2Evaluation() procedure with S4 / S5 per support and S6 for the K2 pair', () => {
  async function pooledK2() {
    const built = fixture()
    const ctx = contextOf(built)
    const unit = await runD2EDiscoveryUnit(research(built), discoveryTask(built, ctx), built.dependencies, { sha256OfText: syncSha })
    if (unit.status !== 'discovery_cap_reached' && unit.status !== 'stopped_by_search_extent_bound' && unit.status !== 'discovery_exhausted') throw new Error(JSON.stringify(unit))
    return { built, ctx, pooled: unit.pooled }
  }
  const authorities = (built: OrchestrationScenario) => [k1Context(built, ENTRY_A, 3), k1Context(built, ENTRY_C, 4)].sort((x, y) => x.supportBuildListEntryId < y.supportBuildListEntryId ? -1 : 1).map(k => ({ supportBuildListEntryId: k.supportBuildListEntryId, k: k.k, contextId: `K1-${k.k}`,
    supportBodySha256: k.supportBodySha256, reservationDigest: k.reservationDigest, reservationBody: k.reservationBody }))
  const k2Task = (built: OrchestrationScenario, ctx: Json, g: BuildListEntry, stage: 'ADM' | 'EXT', over: Partial<D2EReplacementTask> = {}): D2EEvaluationTask => ({
    evaluationId: `${stage}-K2-t03-c1`, stage, evaluatedAgainst: stage === 'ADM' ? 'baseline' : 'replacement_set', ordinal: 1, researchMaxPlanSteps: 20_000, fullRunCap: 8, supportAuthorities: authorities(built),
    replacements: [{ targetIndex: 3, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: g.id, generatedEntrySha256: 'f'.repeat(64), generatedEntryFile: 'g.json',
      requiresSupport: S, contextId: d2eContextId('t03', S), contextReservationDigest: ctx.reservationDigest as string, contextReservation: ctx.reservationBody as Json,
      searchReservationDigest: ctx.reservationDigest as string, ...over }] })

  it('admits a K2 Candidate with found_R on S, S4 / S5 against the authorities and S6 on the pair, with no fixed constraint', async () => {
    const { built, ctx, pooled } = await pooledK2()
    expect(pooled.length).toBeGreaterThan(0)
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const adm = await runD2EEvaluation(input, input.buildListEntries, k2Task(built, ctx, g, 'ADM'), [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    if (adm.status !== 'evaluated') throw new Error(JSON.stringify(adm))
    expect(adm.trialVerdict).not.toBeNull()
    expect(adm.childRecheck).toEqual({ checked: 1, issues: [] })
    expect(Object.keys(adm.supportStaticChecks).sort()).toEqual(S)
    expect(Object.values(adm.supportStaticChecks).every(c => c.S4 && c.S5.satisfied)).toBe(true)
    expect(adm.replacementReservationChecks[g.id]).toMatchObject({ kind: 'k2_pair', digestMatched: true, bodyMatched: true, searchInputDigestMatched: true, satisfied: true })
    expect(Object.keys(adm.supportChecks).sort()).toEqual(S)
    expect(adm.runConflictResolutions).toBe(0)
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    expect(adm.resultDigest).toBe(d1ResultDigest(adm))
  })

  it('stops before the full run on an S6 / S5 / S4 failure, a missing authority or a G store mismatch (guardrail)', async () => {
    const { built, ctx, pooled } = await pooledK2()
    expect(pooled.length).toBeGreaterThan(0)
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const run = (task: D2EEvaluationTask, sha = 'f'.repeat(64)) => runD2EEvaluation(input, input.buildListEntries, task, [g], [sha], built.dependencies, { sha256OfText: syncSha })
    expect(await run(k2Task(built, ctx, g, 'ADM', { searchReservationDigest: 'fnv1a32:00000000' }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S6: support_pair_reservation_mismatch/)] })
    expect(await run(k2Task(built, ctx, g, 'ADM', { contextReservation: { ...(ctx.reservationBody as Json), exclusiveOwnedWeaponIds: [] } }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S6: /)] })
    const badAuthority = { ...k2Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built).map((a, i) => i === 0 ? { ...a, reservationDigest: 'fnv1a32:00000000' } : a) }
    expect(await run(badAuthority)).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S5: /)] })
    const badBody = { ...k2Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built).map((a, i) => i === 1 ? { ...a, supportBodySha256: '0'.repeat(64) } : a) }
    expect(await run(badBody)).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S4: /)] })
    expect(await run({ ...k2Task(built, ctx, g, 'ADM'), supportAuthorities: authorities(built).slice(0, 1) })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/no S5 authority/)] })
    expect(await run(k2Task(built, ctx, g, 'ADM'), '0'.repeat(64))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV1′: /)] })
    expect(await run(k2Task(built, ctx, g, 'ADM', { currentBuildListEntryId: ENTRY_A }))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV2′: /)] })
    expect(await run({ ...k2Task(built, ctx, g, 'ADM'), ordinal: null })).toMatchObject({ status: 'guardrail_violation' })
    expect(preflightSpy.calls).toEqual([])
  })

  it('is the runD2CEvaluation() procedure for a K0 / K1 set: the same facts and resultDigest (I0 / B0 parity of the copy)', async () => {
    const { built, pooled } = await pooledK2()
    const input = research(built)
    // A K1 replacement of Target B with support A (the D2-C shape) and the B0 baseline.
    const support = k1Context(built, ENTRY_A, 3)
    const g = pooled[0]!.generatedEntry!
    const k1 = { targetIndex: 3, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: g.id, generatedEntrySha256: 'f'.repeat(64), generatedEntryFile: 'g.json', requiresSupport: [ENTRY_A],
      contextId: 'K1-t03-a' }
    const d2e = await runD2EEvaluation(input, input.buildListEntries, { evaluationId: 'I0', stage: 'I0', evaluatedAgainst: 'replacement_set', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8,
      supportAuthorities: [{ supportBuildListEntryId: ENTRY_A, k: 3, contextId: 'K1-3', supportBodySha256: support.supportBodySha256, reservationDigest: support.reservationDigest, reservationBody: support.reservationBody }],
      replacements: [{ ...k1, contextReservationDigest: support.reservationDigest, contextReservation: support.reservationBody, searchReservationDigest: null }] }, [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    const d2c = await runD2CEvaluation(input, input.buildListEntries, { evaluationId: 'I0', stage: 'I0', evaluatedAgainst: 'replacement_set', researchMaxPlanSteps: 20_000, fullRunCap: 8,
      replacements: [{ ...k1, supportReservationDigest: support.reservationDigest, supportReservation: support.reservationBody, supportBodySha256: support.supportBodySha256 }] }, [g], built.dependencies, { sha256OfText: syncSha })
    if (d2e.status !== 'evaluated' || d2c.status !== 'evaluated') throw new Error(JSON.stringify([d2e.status, d2c.status]))
    const strip = (x: Json) => Object.fromEntries(Object.entries(x).filter(([k]) => !['replacementReservationChecks', 'childRecheck', 'supportBodySha256Observed'].includes(k)))
    expect(strip(d2e as unknown as Json)).toEqual(strip(d2c as unknown as Json))
    expect(d2e.resultDigest).toBe(d2c.resultDigest)
    const b0e = await runD2EEvaluation(input, input.buildListEntries, { evaluationId: 'B0', stage: 'B0', evaluatedAgainst: 'baseline_reference', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8, supportAuthorities: [],
      replacements: [] }, [], [], built.dependencies, { sha256OfText: syncSha })
    const b0c = await runD2CEvaluation(input, input.buildListEntries, { evaluationId: 'B0', stage: 'B0', evaluatedAgainst: 'baseline_reference', researchMaxPlanSteps: 20_000, fullRunCap: 8, replacements: [] }, [], built.dependencies, { sha256OfText: syncSha })
    expect(b0e.status === 'evaluated' && b0c.status === 'evaluated' && b0e.resultDigest === b0c.resultDigest).toBe(true)
  })
})

// ---------------------------------------------------------------- judgements and the decision (§6.5 / §11)

describe('D2-E judgements and the decision', () => {
  it('orders eligible EXT by completed desc, Conflicts asc, steps asc, discovery ordinal asc and names the improvement kind', () => {
    const m = (ordinal: number, completed: number, conflicts: number, steps: number) => ({ evaluationId: `E${ordinal}`, ordinal, completed, conflicts, steps })
    expect([m(2, 24, 19, 1465), m(1, 25, 20, 1600), m(3, 24, 18, 1500)].sort(compareD2ESelection).map(x => x.evaluationId)).toEqual(['E1', 'E3', 'E2'])
    expect(d2eImprovementKind(true, { completed: 25, conflicts: 20 }, { completed: 24, conflicts: 19 })).toBe('completed_increase')
    expect(d2eImprovementKind(true, { completed: 24, conflicts: 18 }, { completed: 24, conflicts: 19 })).toBe('conflict_decrease_only')
    expect(d2eImprovementKind(false, { completed: 25, conflicts: 18 }, { completed: 24, conflicts: 19 })).toBeNull()
  })

  it('classifies the decision top to bottom and keeps discovery, R5, improved and R6 apart', () => {
    const base: D2EDecisionInput = { invalidReasons: [], unmeasured: [], discoveryOutcome: 'cap_reached', pooledCandidates: 2, admittedCandidates: 2, measuredAdmissions: 2, r5SatisfiedExtensions: [],
      eligibleExtensions: [], improvedExtensions: [], r5OnlyEligibleExtensions: [], equalMetricsExtensions: [], conflictIncreasedExtensions: [], t03SelectedExtensions: [], t03CompletedWithoutNetGainExtensions: [],
      incumbentRegressedExtensions: [], r6SatisfiedExtensions: [], measuredExtensions: ['E1', 'E2'], bestEligibleExtension: null, bestImprovedExtension: null, improvementKind: null, boundLimitedEvaluations: [],
      subject: { evaluationId: 'I0', metrics: { completed: 24, conflicts: 19, steps: 1465 } }, i0Metrics: { completed: 24, conflicts: 19, steps: 1465 } }
    expect(classifyD2EDecision({ ...base, invalidReasons: [{ category: 'guardrail', detail: 'x' }], r6SatisfiedExtensions: ['E1'] }).case).toBe('D2E_INVALID')
    expect(classifyD2EDecision({ ...base, unmeasured: ['DSC-K2-L2'], improvedExtensions: ['E1'], r5SatisfiedExtensions: ['E1'] }))
      .toMatchObject({ case: 'D2E_INCOMPLETE', lowerBound: true, exceedsD2dObservedUnderIncomplete: true, setCoexistenceObservedUnderIncomplete: true, k2CandidateObservedUnderIncomplete: true })
    expect(classifyD2EDecision({ ...base, r6SatisfiedExtensions: ['E1'], improvedExtensions: ['E1'] }).case).toBe('D2E_GLOBAL_COMPLETE_R')
    expect(classifyD2EDecision({ ...base, improvedExtensions: ['E1'], r5SatisfiedExtensions: ['E1'], improvementKind: 'conflict_decrease_only' })).toMatchObject({ case: 'D2E_EXCEEDS_D2D_BEST', improvementKind: 'conflict_decrease_only' })
    expect(classifyD2EDecision({ ...base, r5SatisfiedExtensions: ['E1'] }).case).toBe('D2E_SET_COEXISTENT_NOT_BETTER')
    expect(classifyD2EDecision({ ...base, t03SelectedExtensions: ['E1'] }).case).toBe('D2E_NO_SET_COEXISTENCE')
    expect(classifyD2EDecision({ ...base, admittedCandidates: 0, measuredExtensions: [] }).case).toBe('D2E_NO_ADMITTED_K2_CANDIDATE')
    expect(classifyD2EDecision({ ...base, pooledCandidates: 0, admittedCandidates: 0, measuredAdmissions: 0, measuredExtensions: [], discoveryOutcome: 'ladder_exhausted' }).case).toBe('D2E_NO_K2_CANDIDATE')
    expect(classifyD2EDecision({ ...base, pooledCandidates: 0, admittedCandidates: 0, measuredAdmissions: 0, measuredExtensions: [], discoveryOutcome: 'discovery_exhausted' }).case).toBe('D2E_NO_K2_CANDIDATE')
    expect(classifyD2EDecision(base).vsD2dBest).toEqual({ subjectEvaluationId: 'I0', completedDelta: 0, conflictDelta: 0, stepsDelta: 0, better: false, equalMetrics: true })
  })
})

// ---------------------------------------------------------------- the run analysis (synthetic records over the real derivation)

const CTXV = { calculationContext: { ...D2E_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000 }
const PROC = (at: string) => ({ outcome: 'completed', wallMs: 1, startedAt: `2026-10-11T00:00:${at}.000Z` })
const SUMMARY = JSON.parse(phase2c2ResultRaw).baseline.summary

interface Outcome { completed?: number; conflicts?: { participants: string[]; resourceIdentity?: string | null }[]; notSelected?: string[]; status?: string; termination?: string; timeout?: boolean;
  resourceConflict?: number; t03Target?: boolean; extraSelectedTargets?: string[] }
interface SyntheticOptions { outcomes?: Record<string, Outcome>; pooled?: number; rungs?: string[]; admissionsR1False?: number[] }
interface Synthetic { input: D2EAnalysisInput & { evaluationRows: D2EEvaluationRow[]; evaluationRecords: Map<string, Json | null>; discoveryRows: D2EDiscoveryRow[]; discoveryRecords: Map<string, Json | null> };
  v: D2EValidatedInputs; k2Ids: string[] }

function synthetic(options: SyntheticOptions = {}): Synthetic {
  const outcomes = options.outcomes ?? {}
  const v = validateD2EInputs(realEvidence())
  const k2 = v.k2!, i0 = v.i0!
  const shaMap = new Map<string, string>()
  const sha = (text: string) => shaMap.get(text) ?? syncSha(text)
  const template = fixture().input.buildListEntries[0]!
  // Incumbent G store bodies whose stable keys hash (through shaMap) to the registered keySha256.
  const incumbentBodies = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  i0.replacements.forEach((r, n) => {
    const snapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: `series_skill.variant.${n}`, searchRunId: r.searchIdentity }
    shaMap.set(candidateStableKey(snapshot), r.keySha256)
    incumbentBodies.set(r.file, { bytes: r.bytes, sha256: r.sha256, body: { ...structuredClone(template), id: r.generatedBuildListEntryId, targetWeaponId: r.targetWeaponId,
      calculationContext: { ...D2E_CALCULATION_CONTEXT }, isStale: false, candidateSnapshot: snapshot } })
  })
  // Export support bodies hashing to the CTX supportBodySha256; O_t03 whose stable key hashes to the CTX excluded key SHA-256.
  // Each support body Resets Bonuses on its K1 exclusive OwnedWeapon (C3 then recomputes a non-empty exclusively consumed set).
  const exportEntries: Json[] = v.supports.map((s, i) => {
    const exclusive = (s.contexts[0]!.reservationBody.exclusiveOwnedWeaponIds as string[])
    const route = exclusive.length === 1 ? resetRoute(exclusive[0]!, 10) : { kind: 'existing_gogma_reset_bonuses' as const, sourceOwnedWeaponId: null, operations: [] }
    const body = { ...orchestrationEntry(s.supportBuildListEntryId, orchestrationTarget(`target.outside.${i}`), route) } as unknown as Json
    shaMap.set(stableStringify(body), s.contexts[0]!.supportBodySha256)
    return body
  })
  const k2Exclusive = [...new Set(k2.supportBuildListEntryIds.flatMap(id => v.supports.find(x => x.supportBuildListEntryId === id)!.contexts[0]!.reservationBody.exclusiveOwnedWeaponIds as string[]))].sort()
  const oSnapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: 'series_skill.o.t03' }
  const oKey = candidateStableKey(oSnapshot)
  shaMap.set(oKey, v.contexts.find(c => c.k === k2.k1Contexts[0]!.k)!.excludedRouteKeySha256s[0]!)
  exportEntries.push({ ...structuredClone(template), id: k2.currentBuildListEntryId, targetWeaponId: k2.targetWeaponId, candidateSnapshot: oSnapshot })
  const rvRecord = { ...CTXV, result: { status: 'verified', unitId: 'RV', baseline: { conflictResolutions: 0, maxPlanSteps: 20_000 }, issues: [],
    candidates: [...i0.replacements].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1).map(r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, generatedBuildListEntryId: r.generatedBuildListEntryId,
      generatedEntry: { file: r.file, sha256Observed: r.sha256 }, RV1: { bodySha256Matched: true, idMatched: true, targetMatched: true, calculationContextMatched: true, notStale: true, searchRunIdMatched: true, keySha256Matched: true },
      RV2: { status: 'not_recomputed', replacedBuildListEntryId: null, satisfied: null },
      RV3: { reservationSource: r.origin === 'd2b_k0' ? 'k0_empty' : 'ctx_record', reservationDigest: r.origin === 'd2b_k0' ? D2E_K0_RESERVATION_DIGEST : v.contexts.find(c => c.k === r.contextK)!.reservationDigest, matched: true, issues: [] },
      RV4: { respects: true, blockedHits: { normal: [], gogma: [], skill: [] }, exclusiveHit: [] }, satisfied: true })),
    supports: v.supports.map(s => ({ supportBuildListEntryId: s.supportBuildListEntryId, contextRecords: s.contexts.map(c => c.k), RV5: { expected: s.contexts.map(c => c.supportBodySha256), observed: s.contexts[0]!.supportBodySha256, exportBodies: 1, matched: true },
      RV6: { digestExpected: s.contexts.map(c => c.reservationDigest), digestObserved: s.contexts[0]!.reservationDigest, digestMatched: true, bodyObserved: structuredClone(s.contexts[0]!.reservationBody), bodyMatched: true, satisfied: true } })) } }
  const rvRow = { unitId: 'RV', status: 'verified', notExecutedReason: null, process: PROC('00'), recordFile: { file: 'RV.record.json', bytes: 1, sha256: 'r' } }
  // CTX-K2
  const body = v.registeredReservationBody!
  const k1Bodies = k2.k1Contexts.map(c => v.contexts.find(x => x.k === c.k)!)
  const contextRecord = { ...CTXV, result: { status: 'context_ready', unitId: 'CTX-K2', contextId: k2.contextId, label: k2.label, targetWeaponId: k2.targetWeaponId, currentBuildListEntryId: k2.currentBuildListEntryId,
    supportBuildListEntryIds: k2.supportBuildListEntryIds, supportTargetWeaponIds: k2.supportBuildListEntryIds.map(() => null),
    supportBodySha256s: Object.fromEntries(k2.supportBuildListEntryIds.map(s => [s, v.supports.find(x => x.supportBuildListEntryId === s)!.contexts[0]!.supportBodySha256])),
    reservationBody: structuredClone(body), reservationDigest: D2E_K2_RESERVATION_DIGEST, originDigest: D2E_ORIGIN_DIGEST, scheduleOriginDigest: D2E_ORIGIN_DIGEST, excludedRouteKeys: [oKey],
    excludedRouteKeySha256s: [k1Bodies[0]!.excludedRouteKeySha256s[0]], scheduleExcludedRouteKeys: [oKey], conflictContextCount: 21,
    checks: { C1: { satisfied: true, issues: [] }, C2: { satisfied: true, issues: [] }, C3: { satisfied: true, referencedOwnedWeaponIds: [...k2Exclusive], exclusiveConsumedOwnedWeaponIds: [...k2Exclusive], exclusiveOwnedWeaponIds: [...(body.exclusiveOwnedWeaponIds as string[])].sort() },
      C4: { satisfied: true, issues: [] }, C5: { state: 'matched', expectedDigest: D2E_K2_RESERVATION_DIGEST, observedDigest: D2E_K2_RESERVATION_DIGEST, digestMatched: true, bodyMatched: true },
      C6: { satisfied: true, perSupport: [] }, C7: { satisfied: true, reverseDigest: D2E_K2_RESERVATION_DIGEST } },
    diagnostics: { equalsK1ComponentwiseUnion: true, k1Reservations: {} }, issues: [] } }
  const contextRow = { unitId: 'CTX-K2', contextId: k2.contextId, status: 'context_ready', notExecutedReason: null, process: PROC('03'), recordFile: { file: 'CTX-K2.context.json', bytes: 1, sha256: 'c' } }
  // DSC: L0 / L1 extent bound, L2 pools `pooled` Candidates (cap at 2).
  const pooledCount = options.pooled ?? 2
  const rungs = options.rungs ?? ['L0', 'L1', 'L2']
  const discoveryRows: D2EDiscoveryRow[] = [], discoveryRecords = new Map<string, Json | null>()
  const poolFiles = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  const k2Ids: string[] = []
  const searchIdentity = 'planner-alternative-search.synthetic'
  for (const rung of rungs) {
    const last = rung === 'L2'
    const unitId = `DSC-K2-${rung}`
    const pooled: Json[] = [], deliveries: Json[] = []
    if (last) for (let n = 1; n <= pooledCount; n += 1) {
      const snapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: `series_skill.k2.${n}`, searchRunId: searchIdentity, targetWeaponId: k2.targetWeaponId }
      const key = candidateStableKey(snapshot)
      const id = `build-list.k2.synthetic.${n}`
      k2Ids.push(id)
      const file = `${k2.contextId}-c${n}.generated-entry.json`
      poolFiles.set(file, { bytes: 10, sha256: `g${n}`, body: { ...structuredClone(template), id, targetWeaponId: k2.targetWeaponId, candidateSnapshot: snapshot } })
      const r0Split = Object.fromEntries(k2.supportBuildListEntryIds.map(s => [s, true]))
      deliveries.push({ indexInUnit: n - 1, candidateStableKey: key, keySha256: syncSha(key), cost: 300, action: 'pooled', r0K2: true, r0Split, matchedD2bOrdinal: null, matchedD2cK1: null })
      pooled.push({ indexInContext: n, indexInUnit: n - 1, candidateStableKey: key, keySha256: syncSha(key), cost: 300, routeKind: 'existing_gogma_mixed', routeOperationCount: 300,
        r0K2: { respects: true, blockedHits: {}, exclusiveHit: [] }, r0Split, searchIdentity, reservationDigest: D2E_K2_RESERVATION_DIGEST, generatedBuildListEntryId: id, reusedExisting: false,
        replacement: { status: 'ready', replacedBuildListEntryId: k2.currentBuildListEntryId }, requiresSupport: [...k2.supportBuildListEntryIds], generatedEntry: null,
        generatedEntryFile: { file, bytes: 10, sha256: `g${n}` } })
    }
    const stoppedByConsumer = last && pooledCount === 2
    const status = stoppedByConsumer ? 'discovery_cap_reached' : last ? 'ladder_exhausted' : 'stopped_by_search_extent_bound'
    discoveryRows.push({ unitId, contextId: k2.contextId, rung, status, notExecutedReason: null, process: PROC('04'), recordFile: { file: `${unitId}.record.json`, bytes: 1, sha256: rung } })
    discoveryRecords.set(unitId, { ...CTXV, result: { status, unitId, contextId: k2.contextId, rung, poolSizeAtStart: 0, deliveries, pooled, searchIdentity,
      observedContext: { reservationDigest: D2E_K2_RESERVATION_DIGEST, originDigest: D2E_ORIGIN_DIGEST, excludedRouteKeys: [oKey], currentBuildListEntryId: k2.currentBuildListEntryId, supportBuildListEntryIds: [...k2.supportBuildListEntryIds] },
      search: { deliveredCandidates: deliveries.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: !stoppedByConsumer, stoppedByConsumer, skippedExcludedRouteKeys: 1 },
      timing: { searchVisitMs: 1, materializeMs: 0, searchOnlyMs: 1 } } })
  }
  // Evaluations
  const evaluationRows: D2EEvaluationRow[] = [], evaluationRecords = new Map<string, Json | null>()
  const auth = (s: string) => v.supports.find(x => x.supportBuildListEntryId === s)!.contexts[0]!
  const ownCtx = (contextId: string | null) => v.contexts.find(c => c.contextId === contextId)!
  type Rep = { label: string; targetWeaponId: string; generatedBuildListEntryId: string; sha256: string; requiresSupport: string[]; contextId: string | null; kind: 'k0' | 'k1' | 'k2' }
  const i0Reps: Rep[] = i0.replacements.map(r => ({ label: r.label, targetWeaponId: r.targetWeaponId, generatedBuildListEntryId: r.generatedBuildListEntryId, sha256: r.sha256, requiresSupport: r.requiresSupport,
    contextId: r.contextId, kind: r.origin === 'd2b_k0' ? 'k0' : 'k1' }))
  const k2Rep = (n: number): Rep => ({ label: k2.label, targetWeaponId: k2.targetWeaponId, generatedBuildListEntryId: k2Ids[n - 1]!, sha256: `g${n}`, requiresSupport: [...k2.supportBuildListEntryIds], contextId: k2.contextId, kind: 'k2' })
  const evalOf = (id: string, stage: 'B0' | 'I0' | 'ADM' | 'EXT', ordinal: number | null, repsIn: Rep[], o: Outcome) => {
    const reps = [...repsIn].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1)
    const generated = reps.map(r => r.generatedBuildListEntryId)
    const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort()
    const digest = d1InputDigest(reps.map(r => r.targetWeaponId), generated, reps.map(r => r.sha256), EXPORT_SHA)
    const row: D2EEvaluationRow = { evaluationId: id, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', ordinal,
      replacementTargets: reps.map(r => r.targetWeaponId), generatedEntryIds: generated, generatedEntrySha256s: reps.map(r => r.sha256), requiresSupport: support, inputDigest: digest,
      registeredInputDigest: stage === 'B0' ? D2E_B0_EXPECTED.inputDigest : stage === 'I0' ? D2E_I0_EXPECTED.inputDigest : null, status: 'evaluated', notExecutedReason: null, process: PROC('05'),
      recordFile: { file: `${id}.record.json`, bytes: 1, sha256: 'e' }, runner: null }
    if (o.status !== undefined) row.status = o.status
    evaluationRows.push(row)
    if (o.timeout) { Object.assign(row, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1, startedAt: PROC('05').startedAt }, recordFile: null }); return null }
    const notSelected = new Set(o.notSelected ?? [])
    const selected = [...generated, ...support, 'build-list.other.1', 'build-list.other.2'].filter(x => !notSelected.has(x)).sort()
    const defaultConflicts = stage === 'B0' ? 21 : stage === 'I0' || stage === 'EXT' ? 19 : 21
    const conflicts = (o.conflicts ?? Array.from({ length: defaultConflicts }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] }))).map((c, i) => ({ id: `c${i}`, kind: 'same_skill_counter',
      participants: [...c.participants].sort(), selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: (c as { resourceIdentity?: string | null }).resourceIdentity ?? null, resourceIdentityMatched: (c as { resourceIdentity?: string | null }).resourceIdentity != null }))
    const staticChecks = Object.fromEntries(support.map(s => [s, { S4: true, S5: { digestExpected: auth(s).reservationDigest, digestObserved: auth(s).reservationDigest, digestMatched: true,
      bodyExpected: structuredClone(auth(s).reservationBody), bodyObserved: structuredClone(auth(s).reservationBody), bodyMatched: true, satisfied: true } }]))
    const reservationChecks = Object.fromEntries(reps.filter(r => r.kind !== 'k0').map(r => [r.generatedBuildListEntryId, r.kind === 'k1'
      ? { kind: 'k1_own_context', contextId: r.contextId, digestExpected: ownCtx(r.contextId).reservationDigest, digestObserved: ownCtx(r.contextId).reservationDigest, digestMatched: true, bodyMatched: true, searchInputDigestMatched: null, satisfied: true }
      : { kind: 'k2_pair', contextId: r.contextId, digestExpected: D2E_K2_RESERVATION_DIGEST, digestObserved: D2E_K2_RESERVATION_DIGEST, digestMatched: true, bodyMatched: true, searchInputDigestMatched: true, satisfied: true }]))
    const targetOf = new Map(reps.map(r => [r.generatedBuildListEntryId, r.targetWeaponId]))
    const selectedTargets = [...new Set([...selected.map(x => targetOf.get(x) ?? `other:${x}`), ...(o.extraSelectedTargets ?? [])])].sort()
    const defaultCompleted = stage === 'B0' ? 20 : stage === 'ADM' ? 20 : 24
    const rejected = Array.from({ length: o.resourceConflict ?? (stage === 'B0' ? 21 : 19) }, (_, i) => ({ buildListEntryId: `build-list.rejected.${i}`, reason: 'resource_conflict' }))
    const facts = { preflight: { status: stage === 'B0' ? 'not_run' : 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
      plan: { present: true, termination: { status: o.termination ?? 'exhausted', completedTargetCount: o.completed ?? defaultCompleted, totalTargetCount: 43, reachedLimits: [] }, steps: 1465,
        selectedBuildListEntryIds: selected, warningKinds: [] },
      conflicts, routeCommitment: generated.map(g => ({ buildListEntryId: g, role: 'generated', status: notSelected.has(g) ? 'dropped' : 'committed', provisionalOutcomeSelectedBuildListEntryId: notSelected.has(g) ? 'winner.x' : null,
        rejectionReasons: [] })),
      supportChecks: Object.fromEntries(support.map(s => [s, { S1: true, S2: true, S3: true, S4: true, S5: true }])), trialRunSummary: null,
      trialVerdict: stage === 'ADM' ? { status: 'found_R', generatedSelected: true } : null, baselineSummary: stage === 'B0' ? structuredClone(SUMMARY) : null, steps: [], resultDigest: '',
      rejectedBuildListEntries: rejected, resourceConflictRejections: rejected.length, selectedTargetWeaponIds: selectedTargets, supportStaticChecks: staticChecks,
      supportBodySha256Observed: Object.fromEntries(support.map(s => [s, auth(s).supportBodySha256])), childRecheck: { checked: reps.length, issues: [] }, replacementReservationChecks: reservationChecks }
    facts.resultDigest = d1ResultDigest(facts as unknown as D2EvaluationFacts)
    evaluationRecords.set(id, { ...CTXV, inputDigest: digest, result: { status: o.status ?? 'evaluated', ...facts } })
    return facts
  }
  const b0 = evalOf('B0', 'B0', null, [], outcomes.B0 ?? {})
  const i0f = evalOf('I0', 'I0', null, i0Reps, outcomes.I0 ?? {})
  for (let n = 1; n <= pooledCount; n += 1) {
    const r1False = (options.admissionsR1False ?? []).includes(n)
    evalOf(`ADM-K2-t03-c${n}`, 'ADM', n, [k2Rep(n)], outcomes[`ADM-K2-t03-c${n}`] ?? (r1False ? { status: 'preflight_refused' } : {}))
  }
  for (let n = 1; n <= pooledCount; n += 1) {
    if ((options.admissionsR1False ?? []).includes(n)) continue
    evalOf(`EXT-K2-t03-c${n}`, 'EXT', n, [...i0Reps, k2Rep(n)], outcomes[`EXT-K2-t03-c${n}`] ?? {})
  }
  // The synthetic B0 / I0 results are the parity expectations of this synthetic run (the real ones are registered constants).
  v.expected = { b0: { ...v.expected!.b0, resultDigest: b0?.resultDigest ?? v.expected!.b0.resultDigest }, i0: { ...v.expected!.i0, resultDigest: i0f?.resultDigest ?? v.expected!.i0.resultDigest } }
  v.priorByInputDigest = { [D2E_B0_EXPECTED.inputDigest]: [{ source: 'D2-D', evaluationId: 'B0', status: 'evaluated', inputDigest: D2E_B0_EXPECTED.inputDigest, resultDigest: b0?.resultDigest ?? 'x' }],
    [D2E_I0_EXPECTED.inputDigest]: [{ source: 'D2-D', evaluationId: 'PAIR-t05c1-t07c3', status: 'evaluated', inputDigest: D2E_I0_EXPECTED.inputDigest, resultDigest: i0f?.resultDigest ?? 'x' }] }
  const childProcessCount = 1 + 1 + discoveryRows.length + evaluationRows.filter(r => r.process !== null).length
  const input: Synthetic['input'] = { validated: v, exportSha256: EXPORT_SHA, exportBuildListEntries: exportEntries, baselineBuildListEntries: null, recomputedOriginDigest: D2E_ORIGIN_DIGEST,
    d2cContexts: d2cContexts(), rngEngine: fixture().dependencies.rngEngine, incumbentBodies, rvRow, rvRecord, contextRow, contextRecord, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords, interrupted: false,
    discoveryEnvelopeReached: false, runEnvelopeReached: false, abortReason: null, provenanceIssues: [], evidenceIssues: [], rawConsistencyIssues: [], childProcessCount, sha256OfText: sha }
  return { input, v, k2Ids }
}
const analyze = (s: Synthetic, over: Partial<D2EAnalysisInput> = {}) => analyzeD2ERun({ ...s.input, ...over })
const states = (r: ReturnType<typeof analyze>) => Object.fromEntries(r.parityChecks.map(c => [c.checkId, c.state]))
const categories = (r: ReturnType<typeof analyze>) => r.invalidReasons.map(x => x.category)

describe('D2-E run analysis (§4 - §11)', () => {
  it('replays a clean run: every parity matched, the pool / ADM / EXT re-derived, an improved EXT decides EXCEEDS', () => {
    const s0 = synthetic()
    const t03 = s0.v.k2!.targetWeaponId
    const s = synthetic({ outcomes: { 'EXT-K2-t03-c1': { completed: 25, conflicts: Array.from({ length: 18 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] })), extraSelectedTargets: [] },
      'EXT-K2-t03-c2': { notSelected: [] } } })
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(Object.values(states(r)).every(x => x === 'matched' || x === 'not_applicable')).toBe(true)
    expect(states(r)).toMatchObject({ 'baseline:B0': 'matched', 'd2d_best:I0': 'matched', 'registered_input:I0': 'matched', 'k2_context_registered:CTX-K2': 'matched', 'k1_context:CTX-3': 'matched',
      'k1_context:CTX-4': 'matched' })
    expect(r.rv).toMatchObject({ status: 'verified', satisfied: true })
    expect(r.context.checks).toMatchObject({ C1: true, C2: true, C3: { satisfied: true, routeUnitRejections: 0, recordMatched: { referenced: true, consumed: true, exclusive: true } }, C4: true,
      C5: { state: 'matched' }, C6: { satisfied: true }, C7: true })
    expect(((r.context.checks as Json).C3 as Json).exclusiveConsumedOwnedWeaponIds).toEqual(parseD2ESpecRegisteredReservation(SPEC)!.exclusiveOwnedWeaponIds)
    expect(r.discovery.units.map(u => u.status)).toEqual(['stopped_by_search_extent_bound', 'stopped_by_search_extent_bound', 'discovery_cap_reached'])
    expect(r.discovery.outcome).toBe('cap_reached')
    expect(r.discovery.pool.map(p => p.ordinal)).toEqual([1, 2])
    expect(r.evaluations.map(e => e.evaluationId)).toEqual(['B0', 'I0', 'ADM-K2-t03-c1', 'ADM-K2-t03-c2', 'EXT-K2-t03-c1', 'EXT-K2-t03-c2'])
    const adm = r.evaluations.find(e => e.evaluationId === 'ADM-K2-t03-c1')!
    expect(adm.r1r4).toMatchObject({ R1: true, foundRDiagnostic: true })
    expect(adm.pairReservationCheck).toMatchObject({ S6: { satisfied: true, searchInputDigestMatched: true } })
    const ext1 = r.evaluations.find(e => e.evaluationId === 'EXT-K2-t03-c1')!
    expect(ext1).toMatchObject({ eligible: true, improved: true, improvementKind: 'completed_increase' })
    expect(ext1.extension).toMatchObject({ t03: { selected: true, targetSelected: true }, incumbentRetention: { allIncumbentGeneratedSelected: true }, t03Completion: { t03TargetCompleted: true, netCompletedDelta: 1, t03CompletedWithoutNetGain: false } })
    expect((ext1.extension as Json).t03).toMatchObject({ generatedBuildListEntryId: s.k2Ids[0] })
    const ext2 = r.evaluations.find(e => e.evaluationId === 'EXT-K2-t03-c2')!
    // t03 completed but the net completed stays 24: never a "+1".
    expect(ext2.extension).toMatchObject({ t03Completion: { t03TargetCompleted: true, netCompletedDelta: 0, t03CompletedWithoutNetGain: true } })
    expect(ext2).toMatchObject({ eligible: true, improved: false, equalMetrics: true, improvementKind: null })
    expect(r.decision).toMatchObject({ case: 'D2E_EXCEEDS_D2D_BEST', bestEligibleExtension: 'EXT-K2-t03-c1', bestImprovedExtension: 'EXT-K2-t03-c1', improvementKind: 'completed_increase',
      t03CompletedWithoutNetGainExtensions: ['EXT-K2-t03-c2'], equalMetricsExtensions: ['EXT-K2-t03-c2'] })
    expect(r.decision.vsD2dBest).toMatchObject({ subjectEvaluationId: 'EXT-K2-t03-c1', completedDelta: 1, conflictDelta: -1, better: true })
    expect(r.aggregates.childProcesses).toEqual({ registeredMax: 11, started: 11 })
    expect(t03).toBeTruthy()
  })

  it('decides NO_SET_COEXISTENCE (t03 not selected), SET_COEXISTENT_NOT_BETTER (gate fails) and records the D2-C resources', () => {
    const s0 = synthetic()
    const g1 = s0.k2Ids[0]!, g2 = s0.k2Ids[1]!
    const skill341 = s0.v.d2cT03ResourceIdentities.find(r => r.includes('"counterBefore":341'))!
    const none = analyze(synthetic({ outcomes: { 'EXT-K2-t03-c1': { notSelected: [g1], conflicts: [{ participants: [g1, 'build-list.outside.1'], resourceIdentity: skill341 }, ...Array.from({ length: 18 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] }))] },
      'EXT-K2-t03-c2': { notSelected: [g2] } } }))
    expect(none.invalidReasons).toEqual([])
    expect(none.decision.case).toBe('D2E_NO_SET_COEXISTENCE')
    const e1 = none.evaluations.find(e => e.evaluationId === 'EXT-K2-t03-c1')!
    expect(e1.extension).toMatchObject({ t03: { selected: false, winnerBuildListEntryId: 'winner.x' } })
    expect(((e1.extension as Json).d2cT03ResourcesObserved as Json[]).find(x => x.resourceIdentity === skill341)).toMatchObject({ observed: true })
    expect(((e1.extension as Json).conflictsWithT03G as Json[])[0]).toMatchObject({ others: [{ role: 'outside_set' }] })
    const notBetter = analyze(synthetic({ outcomes: { 'EXT-K2-t03-c1': { completed: 23 }, 'EXT-K2-t03-c2': { notSelected: [g2] } } }))
    expect(notBetter.decision).toMatchObject({ case: 'D2E_SET_COEXISTENT_NOT_BETTER', r5OnlyEligibleExtensions: ['EXT-K2-t03-c1'], bestEligibleExtension: null })
    expect(notBetter.decision.vsD2dBest).toMatchObject({ subjectEvaluationId: 'I0', completedDelta: 0 })
  })

  it('decides NO_K2_CANDIDATE and NO_ADMITTED_K2_CANDIDATE, and GLOBAL_COMPLETE_R only with 43 / 43, Conflict 0, no resource_conflict and R5', () => {
    const empty = analyze(synthetic({ pooled: 0 }))
    expect(empty.invalidReasons).toEqual([])
    expect(empty.decision).toMatchObject({ case: 'D2E_NO_K2_CANDIDATE', discoveryOutcome: 'ladder_exhausted', pooledCandidates: 0 })
    const noAdm = analyze(synthetic({ admissionsR1False: [1, 2] }))
    expect(noAdm.invalidReasons).toEqual([])
    expect(noAdm.decision).toMatchObject({ case: 'D2E_NO_ADMITTED_K2_CANDIDATE', pooledCandidates: 2, admittedCandidates: 0 })
    const complete = analyze(synthetic({ outcomes: { 'EXT-K2-t03-c1': { completed: 43, termination: 'completed', conflicts: [], resourceConflict: 0 } } }))
    expect(complete.decision.case).toBe('D2E_GLOBAL_COMPLETE_R')
    const nearly = analyze(synthetic({ outcomes: { 'EXT-K2-t03-c1': { completed: 43, termination: 'completed', conflicts: [], resourceConflict: 1 } } }))
    expect(nearly.decision.case).toBe('D2E_EXCEEDS_D2D_BEST')
  })

  it('reads timeout / not_executed as unmeasured (INCOMPLETE, a lower bound), never as no Candidate / non-coexistence', () => {
    const s = synthetic({ outcomes: { 'EXT-K2-t03-c2': { timeout: true } } })
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2E_INCOMPLETE', lowerBound: true, unmeasuredEvaluations: ['EXT-K2-t03-c2'], k2CandidateObservedUnderIncomplete: true })
    // A timed-out L2: the discovery is unmeasured, no ADM / EXT follows.
    const l2 = synthetic({ pooled: 0 })
    Object.assign(l2.input.discoveryRows[2]!, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1, startedAt: PROC('04').startedAt }, recordFile: null })
    l2.input.discoveryRecords.delete('DSC-K2-L2')
    const u = analyze(l2, { childProcessCount: 7 })
    expect(u.invalidReasons).toEqual([])
    expect(u.decision).toMatchObject({ case: 'D2E_INCOMPLETE', discoveryOutcome: 'unmeasured', unmeasuredEvaluations: ['DSC-K2-L2'] })
  })

  it('makes an I0 parity mismatch, a C5 mismatch, an S6 failure, a wrong delivery action and a missing record INVALID', () => {
    const mutate = (fn: (s: Synthetic) => void, over: Partial<D2EAnalysisInput> = {}) => { const s = synthetic(); fn(s); return analyze(s, over) }
    const fact = (s: Synthetic, id: string) => (s.input.evaluationRecords.get(id)!.result as Json)
    const redigest = (s: Synthetic, id: string) => { const f = fact(s, id); f.resultDigest = d1ResultDigest(f as unknown as D2EvaluationFacts) }
    expect(categories(mutate(s => { fact(s, 'I0').conflicts = []; redigest(s, 'I0') }))).toContain('d2d_parity')
    expect(categories(mutate(s => { (fact(s, 'B0').plan as Json).steps = 1466; redigest(s, 'B0') }))).toContain('baseline_parity_mismatch')
    expect(categories(mutate(s => { ((s.input.contextRecord!.result as Json).reservationBody as Json).exclusiveOwnedWeaponIds = []; (s.input.contextRecord!.result as Json).reservationDigest = hashStableValue((s.input.contextRecord!.result as Json).reservationBody) })))
      .toEqual(expect.arrayContaining(['k2_context_parity']))
    expect(categories(mutate(s => { const rc = fact(s, 'EXT-K2-t03-c1').replacementReservationChecks as Record<string, Json>; for (const v of Object.values(rc)) if (v.kind === 'k2_pair') v.searchInputDigestMatched = false }))).toContain('guardrail')
    expect(categories(mutate(s => { ((s.input.discoveryRecords.get('DSC-K2-L2')!.result as Json).deliveries as Json[])[0]!.action = 'same_key_as_d2c_k1_pool' }))).toContain('raw_result_mismatch')
    expect(categories(mutate(s => { ((s.input.discoveryRecords.get('DSC-K2-L2')!.result as Json).deliveries as Json[])[0]!.r0Split = { a: true } }))).toContain('guardrail')
    expect(categories(mutate(s => { s.input.evaluationRecords.set('EXT-K2-t03-c2', null) }))).toContain('evidence_integrity')
    expect(categories(mutate(s => { ((s.input.rvRecord!.result as Json).candidates as Json[])[0]!.RV4 = { respects: false, blockedHits: { skill: [341] }, exclusiveHit: [] } }))).toContain('guardrail')
    expect(mutate(() => undefined, { abortReason: 'x' }).decision.case).toBe('D2E_INVALID')
  })

  it('recomputes CTX-K2 C3 from the Export support bodies: a tampered exclusively consumed set or reservation is INVALID', () => {
    const c3Of = (s: Synthetic) => ((s.input.contextRecord!.result as Json).checks as Json).C3 as Json
    const c3Issues = (r: ReturnType<typeof analyze>) => r.invalidReasons.filter(x => x.category === 'guardrail' && x.detail.startsWith('CTX-K2: C3')).map(x => x.detail)
    const run = (fn: (s: Synthetic) => void, over: Partial<D2EAnalysisInput> = {}) => { const s = synthetic(); fn(s); return analyze(s, over) }
    expect(run(() => undefined).invalidReasons).toEqual([])
    const dropped = run(s => { c3Of(s).exclusiveConsumedOwnedWeaponIds = [] })
    expect(dropped.decision.case).toBe('D2E_INVALID')
    expect(c3Issues(dropped).join(';')).toMatch(/exclusiveConsumedOwnedWeaponIds is not the recomputed set/)
    expect(c3Issues(run(s => { c3Of(s).exclusiveConsumedOwnedWeaponIds = [...(c3Of(s).exclusiveConsumedOwnedWeaponIds as string[]), 'owned.not.existing'] })).join(';')).toMatch(/not the recomputed set/)
    expect(c3Issues(run(s => { c3Of(s).exclusiveConsumedOwnedWeaponIds = ['owned.other'] })).join(';')).toMatch(/not the recomputed set/)
    // A support Route the Engine rejects.
    expect(c3Issues(run(s => {
      const k2 = s.v.k2!
      s.input.exportBuildListEntries = (s.input.exportBuildListEntries as Json[]).map(e => {
        if (!k2.supportBuildListEntryIds.includes(e.id as string) || ((e.candidateSnapshot as Json).route as Json).sourceOwnedWeaponId === null) return e
        const snap = e.candidateSnapshot as Json, route = snap.route as Json
        return { ...e, candidateSnapshot: { ...snap, route: { ...route, operations: (route.operations as Json[]).map(op => ({ ...op, gogmaCounterAfter: 13 })) } } }
      })
    })).join(';')).toMatch(/route unit planning rejected/)
    // The reservation exclusive set lacking the consumed ID (the C5 parity fails too).
    const lacking = run(s => { const r = s.input.contextRecord!.result as Json; r.reservationBody = { ...(r.reservationBody as Json), exclusiveOwnedWeaponIds: [] }; r.reservationDigest = hashStableValue(r.reservationBody) })
    expect(c3Issues(lacking).join(';')).toMatch(/lacks/)
    expect(lacking.invalidReasons.map(x => x.category)).toContain('k2_context_parity')
    // No Engine: C3 cannot be recomputed and fails closed.
    expect(c3Issues(run(() => undefined, { rngEngine: null })).join(';')).toMatch(/no RNG Engine/)
  })
})

// ---------------------------------------------------------------- isolation, sources and Production (§10.2 / §10.3 / G44 - G52)

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

describe('D2-E oracle isolation, sources and Production (§10.2 / §10.3 / G44 - G52)', () => {
  it('reaches no oracle, Phase B analysis, population-authority, Phase 2-C2.5-D2-D or Phase 2-C2.5-D2-E module', () => {
    for (const entry of ['./plannerGlobalD2E.ts', './plannerGlobalD2EAnalysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalD2C.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound|Phase2C25D2D|Phase2C25D2E/.test(f))).toEqual([])
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD2.ts', '/src/benchmarks/plannerGlobalD2D.ts', '/src/benchmarks/plannerGlobalD2E.ts',
      '/src/benchmarks/plannerGlobalOptimizationResearch.ts', '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD2E.ts', '/src/benchmarks/plannerGlobalD2EAnalysis.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/domain/models/hashing.ts', '/src/domain/planner/replacement/plannerSearchOrigin.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(codeOnly(analyzerSource)).toMatch(/rngEngine, incumbentBodies/)
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|_1657_|PHASE2C25D2E|PHASE2C27B_FORMAL_TARGETS|phase2c25d2e/)
  })

  it('hard-codes no Target, Entry or stable key; every fnv1a32 digest in the code is a registered one', () => {
    const v = validateD2EInputs(realEvidence())
    const ids = [...v.i0!.replacements.flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.generatedBuildListEntryId, r.searchIdentity, r.keySha256]), v.k2!.targetWeaponId, v.k2!.currentBuildListEntryId,
      ...v.k2!.supportBuildListEntryIds, ...v.k2!.supportTargetWeaponIds]
    const registered = new Set([D2E_K0_RESERVATION_DIGEST, D2E_K2_RESERVATION_DIGEST, D2E_ORIGIN_DIGEST, D2E_I0_EXPECTED.inputDigest, D2E_I0_EXPECTED.resultDigest, D2E_B0_EXPECTED.inputDigest, D2E_B0_EXPECTED.resultDigest])
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|build-list\.(constrained\.)?fnv1a32|planner-alternative-search\.fnv1a32/)
      for (const id of ids) expect(source).not.toContain(id.replace(/^(build-list\.(constrained\.)?|planner-alternative-search\.)/, '').slice(0, 16))
      for (const m of source.matchAll(/fnv1a32:[0-9a-f]{8}/g)) expect(registered.has(m[0])).toBe(true)
    }
  })

  it('writes no resolution, lineage or selected Entry (G1 / G30) and keeps the search to the one K2 context (G44)', () => {
    for (const source of [mainSource, analysisSource]) {
      expect(codeOnly(source)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|mergePlannerConflictScenarioResolution|selectedBuildListEntryId:\s*'/)
      expect(codeOnly(source)).not.toMatch(/runPlannerAlternativeKernel|K3-t|K3_CONTEXT/)
    }
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, S\)/)
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, \[\.\.\.S\]\.reverse\(\)\)/)
    expect(codeOnly(runnerSource)).not.toMatch(/'admit'|composition/)
  })

  it('is never imported by Production, changes no earlier Research module, and counts Production source changes by the registered rule', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2E/.test(source)).map(([path]) => path)).toEqual([])
    // Only the D2-E files themselves may import the D2-E modules, by exact path (never a `D2E` substring of the path: Phase
    // 2-C2.5-D2-E, `plannerGlobalPhase2C25D2E*`, is another Research item, D2-E-A §10.4).
    const allowed = ['./plannerGlobalD2E.ts', './plannerGlobalD2EAnalysis.ts', './plannerGlobalD2E.test.ts']
    const D2E_IMPORT = /(?:from\s+|import\s*\(\s*)['"]\.\/plannerGlobalD2E(?:Analysis)?(?:\.ts)?(?:\?raw)?['"]/
    const illegal = (sources: Record<string, string>) => Object.entries(sources).filter(([path, source]) => !allowed.includes(path) && D2E_IMPORT.test(source)).map(([path]) => path)
    expect(illegal(benchmarkSources)).toEqual([])
    expect(allowed.filter(path => /Phase2C25D2E/.test(path))).toEqual([])
    for (const path of allowed.filter(x => x !== './plannerGlobalD2E.test.ts')) expect(benchmarkSources[path], path).toBeDefined()
    const phase2c25d2e = Object.keys(benchmarkSources).filter(path => /^\.\/plannerGlobalPhase2C25D2E/.test(path))
    expect(phase2c25d2e.length).toBeGreaterThan(0)
    for (const path of phase2c25d2e) {
      expect(illegal({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { runD2EEvaluation } from './plannerGlobalD2E'\n` })).toEqual([path])
      expect(illegal({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { analyzeD2ERun } from './plannerGlobalD2EAnalysis'\n` })).toEqual([path])
    }
    // The D2-E modules themselves never reach Phase 2-C2.5-D2-E (G52).
    for (const path of allowed.filter(x => x !== './plannerGlobalD2E.test.ts')) expect(benchmarkSources[path], path).not.toMatch(/from '\.\/plannerGlobalPhase2C25D2E/)
    expect(d2eProductionChangedFiles(['src/benchmarks/plannerGlobalD2E.ts', 'scripts/run-planner-global-d2e.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d2eProductionChangedFiles(['src/domain/planner/x.ts'])).toEqual(['src/domain/planner/x.ts'])
  })

  it('builds the RV task (9 Candidates, 3 supports, own CTX records) and the evaluation tasks (S5 authorities) from V only', () => {
    const v = validateD2EInputs(realEvidence())
    const rv = d2eReverificationTask(v, d2cContexts())
    expect(rv.candidates.map(c => `${c.label}c${c.ordinal}`)).toEqual(['t00c1', 't01c1', 't04c1', 't05c1', 't06c3', 't07c3', 't08c1', 't09c1', 't10c1'])
    expect(rv.candidates.filter(c => c.origin === 'd2c_k1').map(c => c.k1!.k)).toEqual([1, 5, 6, 7])
    expect(rv.candidates.filter(c => c.origin === 'd2c_k1').every(c => c.k1!.poolReservationDigest === c.k1!.reservationDigest && c.k1!.poolContextRecordSha256 === c.k1!.recordSha256)).toBe(true)
    expect(rv.supports.map(s => s.contexts.map(c => c.k))).toEqual([[6], [3, 5], [1, 4, 7]])
    const i0Task = d2eEvaluationTask(v, 'I0', 'I0', null, v.i0!.replacements.map(r => ({ targetIndex: r.targetIndex, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
      generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntrySha256: r.sha256, generatedEntryFile: r.file, requiresSupport: r.requiresSupport, contextId: r.contextId,
      contextReservationDigest: null, contextReservation: null, searchReservationDigest: null })))
    expect(i0Task.supportAuthorities.map(a => a.k)).toEqual([6, 3, 1])
    expect(i0Task).toMatchObject({ stage: 'I0', evaluatedAgainst: 'replacement_set', ordinal: null, researchMaxPlanSteps: 20_000, fullRunCap: 8 })
  })

  it('writes every §12 required RESULT field in the analyzer', () => {
    for (const field of ['phase:', 'analyzedAt:', 'sources:', 'specDocument:', 'd2d:', 'attestation:', 'raw:', 'documents:', 'd2c:', 'contextRecordsUsed:', 'd2:', 'incumbentGeneratedEntries:',
      'phase2c2Result:', 'export:', 'd2e:', 'runDir:', 'rvRecord:', 'contextRecord:', 'discoveryRecords:', 'generatedEntries:', 'records', 'provenance:', 'formal,', 'measuredHead,', 'analysisHead,',
      'measuredHeadIsAncestor,', 'runStatus,', 'benchmarkCodeSha256,', 'registeredPolicySha256,', 'calculationCodeChangedSinceMeasuredHead,', 'productionChangedFiles:', 'toMeasuredHead:', 'toAnalysisHead:',
      'startAttestation:', 'd2dMeasuredHead:', 'd2cMeasuredHead:', 'd2MeasuredHead:', 'D2E_PROVENANCE_FLAGS', 'd2dResultFieldsRead:', 'd2cResultFieldsRead:', 'd2ResultFieldsRead:', 'contextRecordFieldsRead:',
      'd2dResultModified:', 'd2cResultModified:', 'd2ResultModified:', 'environment:', 'conditions:', 'k2Context:', 'derivationRule:', 'registeredReservation:', 'ladder:', 'k2PoolCap:', 'dedupRules:',
      'deliveryCapPerUnit:', 'incumbent:', 'order:', 'i0Rule:', 'admissionRule:', 'extensionRule:', 'r5Definition:', 'extensionDiagnostics:', 'gate:', 'betterRule:', 'improvedRule:', 'selectionOrder:',
      'r6Definition:', 'rvChecks:', 'contextChecks:', 'supportChecks:', 'supportExpiryCauses:', 'budgets:', 'executionEnvelope:', 'researchMaxPlanSteps:', 'evaluationFullRunCap:', 'decisionRule:',
      'comparisonBaselines:', 'notRun:', 'inputValidation:', 'derivedK2Contexts:', 'derivedI0:', 'rv:', 'context:', 'discovery:', 'evaluations:', 'parityChecks:', 'extensions:', 'comparison:', 'aggregates:',
      'timing:', 'rvWallMs:', 'contextWallMs:', 'discoveryWallMs:', 'evaluationWallMs:', 'runWallMs:', 'discoveryEnvelopeReached:', 'runEnvelopeReached:', 'memory:', 'invalidReasons:', 'decision:']) {
      expect(analyzerSource).toContain(field)
    }
    for (const flag of ['oracleReadByRunner', 'oracleReadByChild', 'oracleReadByAnalyzer', 'populationManifestRead', 'd2dResultModified', 'd2cResultModified', 'd2ResultModified', 'priorEvidenceReusedAsResult',
      'oracleGuidedTargetPopulation', 'newSearchInD2E', 'searchScope', 'newAdmissionInD2E', 'k2ReservationDerivedFromSupportBodies', 'k1ReservationUnionUsedAsSemantics', 'speculativeSupportWrittenAsResolution',
      'alternativeToAlternativeSupport', 'productionSemanticsChanged']) expect(mainSource).toContain(`${flag}:`)
    const r = analyze(synthetic())
    expect(Object.keys(r).sort()).toEqual(['aggregates', 'comparison', 'context', 'decision', 'discovery', 'evaluations', 'extensions', 'invalidReasons', 'parityChecks', 'rv', 'unmeasured'])
    expect(Object.keys(r.decision).sort()).toEqual(['admittedCandidates', 'bestEligibleExtension', 'bestImprovedExtension', 'boundLimitedEvaluations', 'case', 'conflictIncreasedExtensions', 'discoveryOutcome',
      'eligibleExtensions', 'equalMetricsExtensions', 'exceedsD2dObservedUnderIncomplete', 'globalCompleteObservedUnderIncomplete', 'improvedExtensions', 'improvementKind', 'incumbentRegressedExtensions',
      'k2CandidateObservedUnderIncomplete', 'lowerBound', 'pooledCandidates', 'r5OnlyEligibleExtensions', 'r5SatisfiedExtensions', 'reasons', 'setCoexistenceObservedUnderIncomplete',
      't03CompletedWithoutNetGainExtensions', 't03SelectedExtensions', 'unmeasuredEvaluations', 'vsBaseline', 'vsD2cFinal', 'vsD2dBest'])
    for (const e of r.evaluations) for (const k of ['stage', 'ordinal', 'registeredInputDigest', 'inputDigestMatched', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'conflicts',
      'referenceDiff', 'baselineDiff', 'r1r4', 'r5', 'extension', 'gate', 'r5OnlyEligible', 'eligible', 'improved', 'improvementKind', 'equalMetrics', 'conflictIncreased', 'supportChecksByEntry',
      'pairReservationCheck', 'r6', 'priorParity', 'inputDigest', 'resultDigest']) expect(e).toHaveProperty(k)
    for (const c of r.rv.candidates) for (const k of ['label', 'ordinal', 'origin', 'contextId', 'generatedBuildListEntryId', 'generatedEntry', 'RV1', 'RV2', 'RV3', 'RV4', 'satisfied']) expect(c).toHaveProperty(k)
    for (const k of ['contextId', 'status', 'unmeasuredReason', 'process', 'record', 'targetWeaponId', 'currentBuildListEntryId', 'supportBuildListEntryIds', 'supportBodySha256s', 'reservationBody', 'reservationDigest',
      'originDigest', 'excludedRouteKeySha256s', 'conflictContextCount', 'checks', 'diagnostics']) expect(r.context).toHaveProperty(k)
    for (const u of r.discovery.units) for (const k of ['unitId', 'rung', 'extent', 'status', 'unmeasuredReason', 'notExecutedReason', 'process', 'searchIdentity', 'reservationDigest', 'summary', 'deliveries',
      'searchOnlyMs', 'materializeMs', 'wallMs', 'peakHeapBytes', 'peakRssBytes']) expect(u).toHaveProperty(k)
    for (const p of r.discovery.pool) for (const k of ['ordinal', 'unitId', 'rung', 'indexInUnit', 'candidateStableKey', 'keySha256', 'cost', 'routeKind', 'routeOperationCount', 'r0K2', 'r0Split', 'searchIdentity',
      'reservationDigest', 'contextRecordSha256', 'requiresSupport', 'generatedBuildListEntryId', 'reusedExisting', 'generatedEntry', 'replacement']) expect(p).toHaveProperty(k)
    for (const k of ['ranking', 'bestEligibleExtension', 'bestImprovedExtension']) expect(r.extensions).toHaveProperty(k)
    for (const k of ['vsBaseline', 'vsD2cFinal', 'vsD2dBest', 'byExtension']) expect(r.comparison).toHaveProperty(k)
    for (const k of ['evaluations', 'discovery', 'childProcesses', 'fullPlannerRunsStarted', 'runtimeUnsupportedRetries', 'r1', 'r5', 'r6', 'boundLimitedEvaluations', 'supportOutcomes', 'determinismCrossChecks', 'parity']) expect(r.aggregates).toHaveProperty(k)
  })
})

// ---------------------------------------------------------------- start attestation (§10.2)

const DOCS = Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, D2D.sources.documents[k].sha256 as string]))
const observation = () => ({ createdAt: '2026-10-11T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d2e.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D2E_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])),
  observedDocuments: Object.fromEntries(D2E_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: 1, sha256: DOCS[k]! }])),
  observedGStoreFiles: Object.fromEntries(D2E_INCUMBENT_G_STORE_FILES.map(f => [d2eGStoreKey(f.label, f.ordinal), { bytes: f.bytes, sha256: f.sha256 }])),
  observedContextRecords: Object.fromEntries(D2E_CONTEXT_RECORDS.map(c => [String(c.k), { bytes: c.bytes, sha256: c.sha256 }])),
  exportFileName: D2E_REGISTERED_INPUTS.export.file, productionAudit: { baseMain: D2E_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 }, appliedExecutionEnvelope: { ...D2E_EXECUTION_ENVELOPE }, rngEngineVersion: 'production-rng:c5-e7',
  observedCalculationContext: { ...D2E_CALCULATION_CONTEXT }, smoke: null })
const expectation: Parameters<typeof verifyD2EStartAttestation>[1] = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  exportSha256: EXPORT_SHA, chainedDocuments: DOCS, firstChildStartedAt: '2026-10-11T00:00:01.000Z' }

describe('D2-E start attestation (§10.2)', () => {
  it('verifies a clean formal launch at the measurement HEAD and fails on any drift', () => {
    const verify = (patch: object, exp = expectation) => verifyD2EStartAttestation(JSON.parse(JSON.stringify({ ...d2eStartAttestationBody(observation()), ...patch })), exp)
    expect(verify({})).toEqual({ verified: true, issues: [] })
    expect(verify({ productionAudit: { baseMain: D2E_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { maxRung: 'L0', maxChildren: null, budgetMs: null, skipEvaluations: false } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ budgets: { ...D2E_BUDGETS, extensionEvaluationsMax: 3 } }).issues).toContain('budgets differs from the registered condition')
    expect(verify({ k2PoolCap: 3 }).issues).toContain('k2PoolCap differs from the registered condition')
    expect(verify({ appliedExecutionEnvelope: { ...D2E_EXECUTION_ENVELOPE, discoveryEnvelopeMs: 1 } }).verified).toBe(false)
    expect(verify({ rngEngineVersion: 'production-rng:c5-e8' }).verified).toBe(false)
    expect(verify({ observedGStoreFiles: {} }).verified).toBe(false)
    expect(verify({ observedContextRecords: {} }).verified).toBe(false)
    expect(verify({}, { ...expectation, repositoryHead: 'e'.repeat(40) }).issues).toContain('repositoryHead differs')
    expect(verify({}, { ...expectation, benchmarkCodeSha256: 'e'.repeat(64) }).issues).toContain('benchmarkCodeSha256 differs')
    expect(verify({}, { ...expectation, exportSha256: null }).issues).toContain('the observed export is not the registered input')
    expect(verify({}, { ...expectation, chainedDocuments: { ...DOCS, d1a: 'f'.repeat(64) } }).issues).toContain('the observed document d1a is not the chained document')
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-10T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
