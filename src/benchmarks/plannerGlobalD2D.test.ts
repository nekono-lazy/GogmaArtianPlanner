import { beforeEach, describe, expect, it, vi } from 'vitest'
import d2cResultRaw from '../../docs/PLANNER_GLOBAL_D2C_RESULT.json?raw'
import d2ResultRaw from '../../docs/PLANNER_GLOBAL_D2_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import d2cDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md?raw'
import d2cbDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md?raw'
import d2dDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d2d.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d2d.mjs?raw'
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
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, d1ResultDigest } from './plannerGlobalD1'
import type { D2EvaluationFacts } from './plannerGlobalD2'
import { d2cContextId, d2cRungExtent, prepareD2CContextRecord, runD2CDiscoveryUnit, type D2CContextTask, type D2CDiscoveryTask } from './plannerGlobalD2C'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import mainSource from './plannerGlobalD2D.ts?raw'
import analysisSource from './plannerGlobalD2DAnalysis.ts?raw'
import {
  compareD2DSelection,
  d2dEvaluationTask,
  d2dGStoreKey,
  d2dProductionChangedFiles,
  d2dRegisteredConditions,
  d2dRegisteredPolicySha256,
  d2dReverificationCandidates,
  d2dReverificationTask,
  d2dStartAttestationBody,
  deriveD2DSets,
  judgeD2DPairCoexistence,
  parseD2DSpecPairTable,
  projectD2DContextRecord,
  projectD2DD2CResult,
  projectD2DD2Result,
  runD2DEvaluation,
  runD2DReverification,
  validateD2DInputs,
  verifyD2DStartAttestation,
  D2D_B0_EXPECTED,
  D2D_BASE_MAIN,
  D2D_BUDGETS,
  D2D_CALCULATION_CONTEXT,
  D2D_CHAINED_DOCUMENT_KEYS,
  D2D_CONTEXT_RECORDS,
  D2D_EXECUTION_ENVELOPE,
  D2D_G_STORE_FILES,
  D2D_I0_EXPECTED,
  D2D_K0_RESERVATION_DIGEST,
  D2D_REGISTERED_INPUTS,
  D2D_REGISTERED_INPUT_DIGESTS,
  type D2DCandidateRef,
  type D2DDerivedSet,
  type D2DInputEvidence,
  type D2DReverificationTask,
  type D2DValidatedInputs,
} from './plannerGlobalD2D'
import { analyzeD2DRun, classifyD2DDecision, type D2DAnalysisInput, type D2DEvaluationRow, type D2DRvRow } from './plannerGlobalD2DAnalysis'

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

const D2C = JSON.parse(d2cResultRaw)
/** The chained Export SHA-256 (never written in a Research source). */
const EXPORT_SHA = D2C.sources.export.sha256 as string
const D2 = JSON.parse(d2ResultRaw)
const SPEC = lf(d2dDocument)

/** The real committed RESULTs plus G store / CTX record stand-ins rebuilt from them (their ids, Targets and reservation bodies). */
function realEvidence(): D2DInputEvidence {
  const files = Object.fromEntries(Object.entries(D2D_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])) as D2DInputEvidence['files']
  const documents = Object.fromEntries(D2D_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: D2C.sources.documents[k].bytes, sha256: D2C.sources.documents[k].sha256 }]))
  const targetsOf = (result: Json) => (result.discovery as { targets: { label: string; targetWeaponId: string; pool: { ordinal: number; generatedBuildListEntryId: string }[] }[] }).targets
  const gStoreFiles = Object.fromEntries(D2D_G_STORE_FILES.map(f => {
    const t = targetsOf(f.origin === 'd2b_k0' ? D2 : D2C).find(x => x.label === f.label)!
    return [d2dGStoreKey(f.label, f.ordinal), { file: { bytes: f.bytes, sha256: f.sha256 }, json: { id: t.pool.find(p => p.ordinal === f.ordinal)!.generatedBuildListEntryId, targetWeaponId: t.targetWeaponId } }]
  }))
  const contextRecords = Object.fromEntries(D2D_CONTEXT_RECORDS.map(c => {
    const row = (D2C.contexts as Json[]).find(x => x.k === c.k)!
    return [c.k, { file: { bytes: c.bytes, sha256: c.sha256 }, json: { result: { status: 'context_ready', contextId: row.contextId, supportBuildListEntryId: row.supportBuildListEntryId, supportBodySha256: row.supportBodySha256,
      reservationBody: structuredClone(row.reservationBody), reservationDigest: row.reservationDigest, originDigest: row.originDigest, excludedRouteKeys: [], secret: 'never read' } } }]
  }))
  return { files, documents, gStoreFiles, contextRecords, d2cResult: JSON.parse(d2cResultRaw), d2Result: JSON.parse(d2ResultRaw), phase2c2Result: JSON.parse(phase2c2ResultRaw), specMarkdown: SPEC }
}

describe('D2-D registered conditions', () => {
  it('registers the committed inputs by their SHA-256 and every value the D2-D document names', async () => {
    expect(await sha256(d2cResultRaw)).toBe(D2D_REGISTERED_INPUTS.d2cResult.sha256)
    expect(await sha256(d2ResultRaw)).toBe(D2D_REGISTERED_INPUTS.d2Result.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D2D_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(lf(d2cDocument))).toBe(D2D_REGISTERED_INPUTS.d2cSpecDocument.sha256)
    expect(await sha256(lf(d2cbDocument))).toBe(D2D_REGISTERED_INPUTS.d2cbDocument.sha256)
    for (const v of Object.values(D2D_REGISTERED_INPUTS)) expect(SPEC).toContain(v.sha256 ?? EXPORT_SHA)
    expect(D2D_REGISTERED_INPUTS.export.sha256).toBeNull()
    expect(D2.sources.export.sha256).toBe(EXPORT_SHA)
    for (const f of D2D_G_STORE_FILES) { expect(SPEC).toContain(f.sha256); expect(SPEC).toContain(f.file.replace('.generated-entry.json', '')) }
    for (const c of D2D_CONTEXT_RECORDS) expect(SPEC).toContain(c.sha256)
    for (const d of [D2D_K0_RESERVATION_DIGEST, D2D_REGISTERED_INPUT_DIGESTS.I0, ...D2D_REGISTERED_INPUT_DIGESTS.pairs, D2D_B0_EXPECTED.inputDigest, D2D_B0_EXPECTED.resultDigest, D2D_I0_EXPECTED.resultDigest]) expect(SPEC).toContain(d)
    expect(D2D_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
  })

  it('fixes the budgets, the envelope and the order as D2-D-A registers them', () => {
    expect(D2D_BUDGETS).toEqual({ newSearch: 0, candidateDiscovery: 0, contextRecords: 0, admissions: 0, rvChildren: 1, b0Evaluations: 1, i0Evaluations: 1, pairEvaluations: 6, evaluationRequestsMax: 8,
      childProcessesMax: 9, evaluationFullRunCap: 8, fullPlannerRunsMax: 64, researchMaxPlanSteps: 20_000 })
    expect(D2D_EXECUTION_ENVELOPE).toEqual({ rvBudgetMs: 600_000, evaluationBudgetMs: 1_800_000, runBudgetMs: 14_400_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none',
      memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D2D_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(SPEC).toMatch(/評価リクエスト合計 \| \*\*8以下\*\*（B0 1 \+ I0 1 \+ PAIR 6）/)
    expect(SPEC).toMatch(/child process合計 \| \*\*9以下\*\*（RV 1 \+ 評価 8）/)
    expect(SPEC).toContain('V → RV → B0 → I0 → PAIR')
    const c = d2dRegisteredConditions()
    expect(c.order).toEqual(['V', 'RV', 'B0', 'I0', 'PAIR 1 -> 6'])
    expect(c.selectionOrder).toEqual(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'PAIR ordinal asc'])
    expect(c.decisionRule.map(r => r.split(':')[0])).toEqual(['D2D_INVALID', 'D2D_INCOMPLETE', 'D2D_GLOBAL_COMPLETE_R', 'D2D_EXCEEDS_D2C_FINAL', 'D2D_SET_COEXISTENT_NOT_BETTER', 'D2D_NO_SET_COEXISTENCE'])
    expect(d2dRegisteredPolicySha256(syncSha)).toBe(d2dRegisteredPolicySha256(syncSha))
  })

  it('reads only the allowlisted D2-C / D2 RESULT and CTX record fields', () => {
    const d2c = projectD2DD2CResult(JSON.parse(d2cResultRaw))!
    expect(d2c.discoveryTargets.map(t => t.label)).toEqual(['t00', 't04', 't05', 't10'])
    expect(d2c.contexts.map(c => c.k)).toEqual([1, 5, 6, 7])
    expect(d2c.evaluations.map(e => e.evaluationId).sort()).toEqual(['ADM-t05-c1', 'ADM-t05-c2', 'B0', 'CMP-t05-c1', 'CMP-t05-c2', 'CMP-t10-c1'])
    expect(d2c.evaluations.filter(e => e.conflicts !== null).map(e => e.evaluationId).sort()).toEqual(['CMP-t05-c1', 'CMP-t05-c2'])
    expect(JSON.stringify(d2c)).not.toMatch(/reservationBody|oracle|referenceDiff|supportChecksByEntry/i)
    const d2 = projectD2DD2Result(JSON.parse(d2ResultRaw))!
    expect(d2.discoveryTargets.map(t => t.label)).toEqual(['t01', 't06', 't07', 't08', 't09'])
    expect(d2.evaluations.map(e => e.evaluationId).sort()).toEqual(['ADM-t07-c1', 'ADM-t07-c2', 'ADM-t07-c3', 'B0'])
    expect(d2.sources.generatedEntries.map(g => g.file).sort()).toEqual(D2D_G_STORE_FILES.filter(f => f.origin === 'd2b_k0').map(f => f.file).sort())
    const ctx = projectD2DContextRecord({ result: { status: 'context_ready', contextId: 'c', supportBuildListEntryId: 's', supportBodySha256: 'b', reservationBody: { a: 1 }, reservationDigest: 'd', originDigest: 'o',
      excludedRouteKeys: [], checks: { secret: 1 } } })
    expect(Object.keys(ctx.record!).sort()).toEqual(['contextId', 'reservationBody', 'reservationDigest', 'status', 'supportBodySha256', 'supportBuildListEntryId'])
    expect(projectD2DContextRecord({ result: { status: 'context_ready', reservationBody: '{"a":1}', reservationDigest: 'd', supportBodySha256: 'b', originDigest: 'o', excludedRouteKeys: [] } }).issue).toMatch(/not a JSON object/)
  })
})

// ---------------------------------------------------------------- V and the §3.1 derivation

describe('D2-D V: F / Fixed / P07 / P05 / PAIRS re-derived from the D2-C / D2 RESULTs (§3.1 / §3.2 / §9.1)', () => {
  it('derives exactly the §3.2 PAIRs and reproduces the §1.8 inputDigests from the committed RESULTs', () => {
    const v = validateD2DInputs(realEvidence())
    expect(v.issues).toEqual([])
    const d = v.derivation!
    expect(d.final.map(r => [r.label, r.ordinal, r.origin])).toEqual([['t00', 1, 'd2c_k1'], ['t01', 1, 'd2b_k0'], ['t04', 1, 'd2c_k1'], ['t06', 3, 'd2b_k0'], ['t07', 1, 'd2b_k0'],
      ['t08', 1, 'd2b_k0'], ['t09', 1, 'd2b_k0'], ['t10', 1, 'd2c_k1']])
    expect(d.fixed.map(r => r.label)).toEqual(['t00', 't01', 't04', 't06', 't08', 't09', 't10'])
    expect(d.p07.map(r => r.ordinal)).toEqual([1, 2, 3])
    expect(d.p05.map(r => r.ordinal)).toEqual([1, 2])
    expect(d.i0?.inputDigest).toBe(D2D_REGISTERED_INPUT_DIGESTS.I0)
    expect(d.pairs.map(p => [p.evaluationId, p.inputDigest])).toEqual(parseD2DSpecPairTable(SPEC).map(r => [r.evaluationId, r.inputDigest]))
    expect(d.pairs.map(p => p.inputDigest)).toEqual([...D2D_REGISTERED_INPUT_DIGESTS.pairs])
    expect(d.pairs.every(p => p.generatedBuildListEntryIds.length === 9 && p.requiresSupport.length === 3)).toBe(true)
    expect(d.i0!.requiresSupport).toHaveLength(2)
    expect(v.supports.map(s => s.contexts.map(c => c.k))).toEqual([[6], [5], [1, 7]])
    expect(v.d2cT05ResourceIdentities).toEqual(['{"counterBefore":485,"counterStream":"skill","kind":"same_skill_counter"}'])
    expect(v.knownD2C.map(k => [k.evaluationId, k.completed, k.conflicts, k.r5Satisfied, k.t07Selected])).toEqual([['CMP-t05-c1', 23, 20, false, false], ['CMP-t05-c2', 23, 21, false, false]])
    expect(v.expected?.b0).toMatchObject({ inputDigest: D2D_B0_EXPECTED.inputDigest, resultDigest: D2D_B0_EXPECTED.resultDigest, completed: 20, conflicts: 21, steps: 1465 })
    expect(v.expected?.i0).toMatchObject({ evaluationId: 'CMP-t10-c1', inputDigest: D2D_I0_EXPECTED.inputDigest, resultDigest: D2D_I0_EXPECTED.resultDigest, completed: 23, conflicts: 20 })
    expect(v.priorByInputDigest[D2D_B0_EXPECTED.inputDigest]?.map(x => `${x.source}:${x.evaluationId}`)).toEqual(['D2:B0', 'D2-C:B0'])
    for (const p of d.pairs) expect(v.priorByInputDigest[p.inputDigest]).toBeUndefined()
    // Every PAIR changes t05 and t07 only: the Fixed 7 are the same bodies in every set.
    for (const p of d.pairs) expect(p.replacements.filter(r => r.label !== 't05' && r.label !== 't07').map(r => r.generatedBuildListEntryId)).toEqual(d.fixed.map(r => r.generatedBuildListEntryId))
  })

  const failing = (mutate: (e: D2DInputEvidence) => void) => {
    const e = realEvidence()
    mutate(e)
    const v = validateD2DInputs(e)
    expect(v.passed).toBe(false)
    expect(v.contexts).toEqual([])
    return v.issues.join(';')
  }

  it('fails closed on a missing file, a digest / byte mismatch or a changed RESULT, never substituting a value', () => {
    expect(failing(e => { e.files.d2cAttestation = null })).toMatch(/d2cAttestation: .* is missing/)
    expect(failing(e => { (e.d2cResult as { sources: { export: { sha256: string } } }).sources.export.sha256 = '3'.repeat(64) })).toMatch(/chained Export SHA-256/)
    expect(failing(e => { e.files.d2cResult = { bytes: 1_541_755, sha256: '0'.repeat(64) } })).toMatch(/d2cResult: SHA-256/)
    expect(failing(e => { e.files.export = { bytes: 1, sha256: EXPORT_SHA } })).toMatch(/export: 1 bytes/)
    expect(failing(e => { (e.d2cResult as { decision: { case: string } }).decision.case = 'D2C_INCOMPLETE' })).toMatch(/decision.case is not D2C_EXCEEDS_D2B_MAIN/)
    expect(failing(e => { (e.d2cResult as { composition: { main: { finalMetrics: unknown } } }).composition.main.finalMetrics = { completed: 22, conflicts: 20, steps: 1465 } })).toMatch(/finalMetrics is not 23/)
    expect(failing(e => { e.documents.d1a = { bytes: 1, sha256: '1'.repeat(64) } })).toMatch(/not the document D2-C RESULT sources.documents names/)
    expect(failing(e => { (e.d2Result as { evaluations: { evaluationId: string; r1r4: { R1: boolean } }[] }).evaluations.find(x => x.evaluationId === 'ADM-t07-c2')!.r1r4.R1 = false })).toMatch(/D2 ADM-t07-c2 R1 is not true/)
  })

  it('fails closed on a missing / changed G store body or CTX record, a string reservationBody or a §3.2 table difference', () => {
    expect(failing(e => { e.gStoreFiles['t07-c3'] = null })).toMatch(/t07-c3.generated-entry.json: the G store file is missing/)
    expect(failing(e => { (e.gStoreFiles['t05-c2']!.json as { id: string }).id = 'other' })).toMatch(/K1-t05-61066e62-c2.generated-entry.json: the body is not the derived G/)
    expect(failing(e => { e.contextRecords[6]!.file = { bytes: 31_237, sha256: '2'.repeat(64) } })).toMatch(/CTX-6.context.json: the CTX record is not the registered one/)
    expect(failing(e => { const r = (e.contextRecords[1]!.json as { result: Json }).result; r.reservationBody = stableStringify(r.reservationBody) })).toMatch(/CTX-1.context.json: .*not a JSON object/)
    expect(failing(e => { ((e.contextRecords[7]!.json as { result: Json }).result.reservationBody as Json).exclusiveOwnedWeaponIds = ['x'] })).toMatch(/CTX-7.context.json: reservationBody does not hash/)
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace(/(\| 2 \| `PAIR-t05c1-t07c2` .*)`fnv1a32:30ea5123` \|/, '$1`fnv1a32:00000000` |') })).toMatch(/PAIR-t05c1-t07c2: the §3.1 derivation is not the §3.2 table row 2/)
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| 3 | `PAIR-t05c1-t07c3` | K1 c1（`…fc2f3f48`） |', '| 3 | `PAIR-t05c1-t07c3` | K1 c2（`…b63619ae`） |') })).toMatch(/PAIR-t05c1-t07c3: the §3.1 derivation is not the §3.2 table row 3/)
  })

  it('parses the §3.2 table with 同上 carrying the supports', () => {
    const t = parseD2DSpecPairTable(SPEC)
    expect(t.map(r => [r.pairOrdinal, r.t05Ordinal, r.t07Ordinal, r.generatedCount, r.supportSuffixes.length])).toEqual([[1, 1, 1, 9, 3], [2, 1, 2, 9, 3], [3, 1, 3, 9, 3], [4, 2, 1, 9, 3], [5, 2, 2, 9, 3], [6, 2, 3, 9, 3]])
    expect(new Set(t.map(r => r.supportSuffixes.join()))).toHaveProperty('size', 1)
  })

  it('derives mechanically from the RESULT rows alone (a changed accepted G fails, a reordered pool keeps the ordinal order)', () => {
    const e = realEvidence()
    const d2c = projectD2DD2CResult(e.d2cResult)!, d2 = projectD2DD2Result(e.d2Result)!
    d2.discoveryTargets.find(t => t.label === 't07')!.pool.reverse()
    expect(deriveD2DSets(d2c, d2, EXPORT_SHA).pairs.map(p => p.inputDigest)).toEqual([...D2D_REGISTERED_INPUT_DIGESTS.pairs])
    d2c.compositionMain.finalAccepted.find(a => a.label === 't04')!.generatedBuildListEntryId = 'changed'
    expect(deriveD2DSets(d2c, d2, EXPORT_SHA).issues).toContain('t04: the accepted G is not the pool G')
  })
})

// ---------------------------------------------------------------- RV and the evaluation wrapper on the Fake RNG Engine fixture (§6 / §4)

const TARGET_A = 'target.d2d.a', TARGET_B = 'target.d2d.b'
const ENTRY_A = 'build-list.d2d.a' as BuildListEntryId, ENTRY_B = 'build-list.d2d.b' as BuildListEntryId
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source'

function fixture(): OrchestrationScenario {
  const skill = { seriesSkillId: SKILL_A, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const ownedWeapons = [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }), orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B })]
  const entries = [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] })]
  return orchestrationScenario({ targets: [a, b], ownedWeapons, entries })
}
const research = (built: OrchestrationScenario) => ({ ...built.input, options: { maxPlanSteps: 20_000 } })
const E1 = [TARGET_B, ...Array.from({ length: 10 }, (_, i) => `target.e1.${i}`)]
const E1_O = [ENTRY_B, ...Array.from({ length: 10 }, (_, i) => `build-list.e1.${i}`)]
function contextOf(built: OrchestrationScenario) {
  const input = research(built)
  const task: D2CContextTask = { unitId: 'CTX-1', contextId: d2cContextId('t00', ENTRY_A), k: 1, label: 't00', targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, supportBuildListEntryId: ENTRY_A,
    e1TargetWeaponIds: E1, e1CurrentBuildListEntryIds: E1_O, registeredReservationDigest: null, phaseBReservations: [], researchMaxPlanSteps: 20_000 }
  return JSON.parse(JSON.stringify(prepareD2CContextRecord(input, derivePhase2C26B2C1Schedule(input, built.dependencies), input.buildListEntries, task, built.dependencies, syncSha)))
}
async function discovered() {
  const built = fixture()
  const ctx = contextOf(built)
  const task: D2CDiscoveryTask = { unitId: 'DSC-1-L0', contextId: d2cContextId('t00', ENTRY_A), k: 1, label: 't00', targetWeaponId: TARGET_B, supportBuildListEntryId: ENTRY_A, currentBuildListEntryId: ENTRY_B,
    rung: 'L0', extent: d2cRungExtent('L0'), context: { recordSha256: 'r', reservationBody: ctx.reservationBody, reservationDigest: ctx.reservationDigest, originDigest: ctx.originDigest, excludedRouteKeys: ctx.excludedRouteKeys },
    poolKeysAtStart: [], d2bK0Pool: [], poolCap: 2, researchMaxPlanSteps: 20_000 }
  const unit = await runD2CDiscoveryUnit(research(built), task, built.dependencies, { sha256OfText: syncSha })
  if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
  return { built, ctx, pooled: unit.pooled }
}

describe('D2-D RV (§6.1): no Search, no full run', () => {
  it('re-verifies a K1 Candidate (body, replacement, CTX reservation, R0) and the support (S4 / S5) from Production parts', async () => {
    const { built, ctx, pooled } = await discovered()
    // The fixture Entry carries the fixture CalculationContext; RV1 compares the registered one.
    const g = { ...pooled[0]!.generatedEntry!, calculationContext: { ...D2D_CALCULATION_CONTEXT } } as BuildListEntry
    const input = research(built)
    const schedule = derivePhase2C26B2C1Schedule(input, built.dependencies)
    const task: D2DReverificationTask = { unitId: 'RV', k0ReservationDigest: D2D_K0_RESERVATION_DIGEST, researchMaxPlanSteps: 20_000,
      candidates: [{ label: 't00', ordinal: 1, origin: 'd2c_k1', contextId: ctx.contextId, generatedBuildListEntryId: g.id, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedEntryFile: 'g.json',
        generatedEntrySha256: 'f'.repeat(64), searchIdentity: g.candidateSnapshot.searchRunId, keySha256: syncSha(candidateStableKey(g.candidateSnapshot)),
        k1: { k: 1, recordSha256: 'r', reservationBody: ctx.reservationBody, reservationDigest: ctx.reservationDigest, poolReservationDigest: ctx.reservationDigest, poolContextRecordSha256: 'r' } }],
      supports: [{ supportBuildListEntryId: ENTRY_A, contexts: [{ k: 1, supportBodySha256: ctx.supportBodySha256, reservationDigest: ctx.reservationDigest, reservationBody: ctx.reservationBody }] }] }
    const ok = runD2DReverification(input, input.buildListEntries, schedule, task, [g], ['f'.repeat(64)], built.dependencies, syncSha)
    expect(ok.candidates[0]).toMatchObject({ satisfied: true, RV2: { status: 'ready', replacedBuildListEntryId: ENTRY_B, satisfied: true }, RV3: { reservationSource: 'ctx_record', matched: true }, RV4: { respects: true } })
    expect(Object.values(ok.candidates[0]!.RV1).every(Boolean)).toBe(true)
    expect(ok.supports[0]).toMatchObject({ RV5: { matched: true }, RV6: { digestMatched: true, bodyMatched: true, satisfied: true } })
    expect(ok.supports[0]!.RV6.bodyObserved).toEqual(ctx.reservationBody)
    // Three supports are registered: one alone is a guardrail at the set level, never a silent pass.
    expect(ok.status).toBe('guardrail_violation')
    expect(ok.issues).toEqual(['1 support Entries, not 3'])
    expect(preflightSpy.calls).toEqual([])
    // Tampering fails closed per check.
    const bad = runD2DReverification(input, input.buildListEntries, schedule, { ...task, candidates: [{ ...task.candidates[0]!, searchIdentity: 'other', k1: { ...task.candidates[0]!.k1!, poolReservationDigest: 'fnv1a32:00000000' } }],
      supports: [{ ...task.supports[0]!, contexts: [{ ...task.supports[0]!.contexts[0]!, reservationBody: { ...ctx.reservationBody, exclusiveOwnedWeaponIds: [] } }] }] }, [g], ['0'.repeat(64)], built.dependencies, syncSha)
    expect(bad.candidates[0]!.RV1).toMatchObject({ bodySha256Matched: false, searchRunIdMatched: false })
    expect(bad.candidates[0]!.RV3.matched).toBe(false)
    expect(bad.supports[0]!.RV6).toMatchObject({ digestMatched: true, bodyMatched: false, satisfied: false })
    expect(bad.issues).toEqual(expect.arrayContaining(['t00 c1: RV1 .. RV4 do not hold', `${ENTRY_A}: RV5 / RV6 do not hold`]))
  })
})

describe('D2-D evaluations: the child RV1 / RV2 recheck, G1 and the D2-C I0 procedure (§4 / §6.2)', () => {
  const evalTask = (stage: 'B0' | 'I0' | 'PAIR', g: BuildListEntry | null, sha = 'f'.repeat(64)) => ({ evaluationId: stage === 'PAIR' ? 'PAIR-x' : stage, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' as const : 'replacement_set' as const,
    pairOrdinal: stage === 'PAIR' ? 1 : null, researchMaxPlanSteps: 20_000, fullRunCap: 8,
    replacements: g === null ? [] : [{ targetIndex: 0, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: g.id, generatedEntrySha256: sha, generatedEntryFile: 'g.json',
      requiresSupport: [], contextId: null, supportReservationDigest: null, supportReservation: null, supportBodySha256: null }] })

  it('evaluates PAIR / I0 as one replacement_set run without found_R and B0 as the persisted baseline, with no fixed constraint', async () => {
    const { built, pooled } = await discovered()
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const pair = await runD2DEvaluation(input, input.buildListEntries, evalTask('PAIR', g), [g], ['f'.repeat(64)], built.dependencies, { sha256OfText: syncSha })
    if (pair.status !== 'evaluated') throw new Error(JSON.stringify(pair))
    expect(pair.trialVerdict).toBeNull()
    expect(pair.childRecheck).toEqual({ checked: 1, issues: [] })
    expect(pair.runConflictResolutions).toBe(0)
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    expect(pair.resultDigest).toBe(d1ResultDigest(pair))
    const b0 = await runD2DEvaluation(input, input.buildListEntries, evalTask('B0', null), [], [], built.dependencies, { sha256OfText: syncSha })
    expect(b0.status === 'evaluated' && b0.baselineSummary !== null && b0.preflight.status === 'not_run').toBe(true)
  })

  it('stops before the full run on a G store body whose SHA-256 / id / Target / replacement is not the registered one', async () => {
    const { built, pooled } = await discovered()
    const g = pooled[0]!.generatedEntry!
    const input = research(built)
    const run = (body: BuildListEntry, observed: string, task = evalTask('PAIR', g)) => runD2DEvaluation(input, input.buildListEntries, task, [body], [observed], built.dependencies, { sha256OfText: syncSha })
    expect(await run(g, '0'.repeat(64))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV1: .* SHA-256/)] })
    expect(await run({ ...g, id: 'other' as BuildListEntryId }, 'f'.repeat(64))).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV1: .*id \/ Target/)] })
    expect(await run(g, 'f'.repeat(64), { ...evalTask('PAIR', g), replacements: [{ ...evalTask('PAIR', g).replacements[0]!, currentBuildListEntryId: ENTRY_A }] }))
      .toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^RV2: /)] })
    expect(await run(g, 'f'.repeat(64), { ...evalTask('PAIR', g), pairOrdinal: null })).toMatchObject({ status: 'guardrail_violation' })
    expect(preflightSpy.calls).toEqual([])
  })
})

// ---------------------------------------------------------------- judgements (§5)

describe('D2-D judgements (§5)', () => {
  it('records pairCoexistence apart from R5 and finds the D2-C Skill 485 resource', () => {
    const skill = '{"counterBefore":485,"counterStream":"skill","kind":"same_skill_counter"}'
    const base = { t05: 'g5', t07: 'g7', t05Target: 'T5', t07Target: 'T7', members: ['g5', 'g7', 'g1', 's1'], selectedTargets: ['T5', 'T7'], d2cT05ResourceIdentities: [skill] }
    const both = judgeD2DPairCoexistence({ ...base, selected: ['g5', 'g7', 'g1'], routeCommitment: [], conflicts: [{ id: 'c', kind: 'same_gogma_counter', participants: ['g1', 'g5'], resourceIdentity: 'r', selectedBuildListEntryId: null }] })
    expect(both).toMatchObject({ pairCoexistence: true, conflictsBetweenPair: [], conflictsWithPair: [{ id: 'c' }], d2cT05ResourcesObserved: [{ resourceIdentity: skill, observed: false }] })
    const clash = judgeD2DPairCoexistence({ ...base, selected: ['g5', 'g1'], selectedTargets: ['T5'], routeCommitment: [{ buildListEntryId: 'g7', provisionalOutcomeSelectedBuildListEntryId: 'g5' }],
      conflicts: [{ id: 'k', kind: 'same_skill_counter', participants: ['g5', 'g7'], resourceIdentity: skill, selectedBuildListEntryId: null }] })
    expect(clash).toMatchObject({ pairCoexistence: false, t07: { selected: false, winnerBuildListEntryId: 'g5', targetSelected: false }, conflictsBetweenPair: [{ id: 'k' }], d2cT05ResourcesObserved: [{ observed: true }] })
  })

  it('orders eligible PAIRs by completed desc, Conflicts asc, steps asc, PAIR ordinal asc', () => {
    const m = (pairOrdinal: number, completed: number, conflicts: number, steps: number) => ({ evaluationId: `P${pairOrdinal}`, pairOrdinal, completed, conflicts, steps })
    expect([m(1, 23, 20, 1465), m(2, 24, 22, 1500), m(3, 24, 21, 1600), m(4, 24, 21, 1500), m(5, 24, 21, 1500)].sort(compareD2DSelection).map(x => x.evaluationId)).toEqual(['P4', 'P5', 'P3', 'P2', 'P1'])
  })

  it('classifies the decision top to bottom and never reads R5 or pairCoexistence as R6 / improvement', () => {
    const base = { invalidReasons: [], unmeasured: [], r5SatisfiedPairs: [], eligiblePairs: [], improvedPairs: [], r5OnlyEligiblePairs: [], equalMetricsPairs: [], conflictIncreasedPairs: [],
      pairCoexistencePairs: [], pairCoexistentButSetNotCoexistentPairs: [], r6SatisfiedPairs: [], measuredPairs: ['P1'], bestEligiblePair: null, bestImprovedPair: null, boundLimitedEvaluations: [],
      subject: { evaluationId: 'I0', metrics: { completed: 23, conflicts: 20, steps: 1465 } }, i0Metrics: { completed: 23, conflicts: 20, steps: 1465 } }
    expect(classifyD2DDecision({ ...base, invalidReasons: [{ category: 'guardrail', detail: 'x' }], r6SatisfiedPairs: ['P1'] }).case).toBe('D2D_INVALID')
    const incomplete = classifyD2DDecision({ ...base, unmeasured: ['P2'], r5SatisfiedPairs: ['P1'], improvedPairs: ['P1'] })
    expect(incomplete).toMatchObject({ case: 'D2D_INCOMPLETE', lowerBound: true, exceedsD2cObservedUnderIncomplete: true, setCoexistenceObservedUnderIncomplete: true, globalCompleteObservedUnderIncomplete: false })
    expect(classifyD2DDecision({ ...base, r6SatisfiedPairs: ['P1'], improvedPairs: ['P1'] }).case).toBe('D2D_GLOBAL_COMPLETE_R')
    expect(classifyD2DDecision({ ...base, improvedPairs: ['P1'], r5SatisfiedPairs: ['P1'] }).case).toBe('D2D_EXCEEDS_D2C_FINAL')
    expect(classifyD2DDecision({ ...base, r5SatisfiedPairs: ['P1'] }).case).toBe('D2D_SET_COEXISTENT_NOT_BETTER')
    expect(classifyD2DDecision({ ...base, pairCoexistencePairs: ['P1'] }).case).toBe('D2D_NO_SET_COEXISTENCE')
    expect(classifyD2DDecision(base).vsD2cFinal).toEqual({ subjectEvaluationId: 'I0', completedDelta: 0, conflictDelta: 0, stepsDelta: 0, better: false, equalMetrics: true })
  })
})

// ---------------------------------------------------------------- the run analysis (synthetic records over the real derivation)

const CTXV = { calculationContext: { ...D2D_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000 }
const PROC = (at: string) => ({ outcome: 'completed', wallMs: 1, startedAt: `2026-10-11T00:00:${at}.000Z` })
const SKILL485 = '{"counterBefore":485,"counterStream":"skill","kind":"same_skill_counter"}'
const EXPORT = EXPORT_SHA
const SUMMARY = JSON.parse(phase2c2ResultRaw).baseline.summary

interface Outcome { completed?: number; conflicts?: { participants: string[]; resourceIdentity?: string | null }[]; notSelected?: string[]; status?: string; total?: number; termination?: string; timeout?: boolean }
interface Synthetic { input: D2DAnalysisInput & { evaluationRows: D2DEvaluationRow[]; evaluationRecords: Map<string, Json | null> }; v: D2DValidatedInputs; shaMap: Map<string, string> }

function synthetic(outcomes: Record<string, Outcome> = {}): Synthetic {
  const v = validateD2DInputs(realEvidence())
  const d = v.derivation!
  const shaMap = new Map<string, string>()
  const sha = (text: string) => shaMap.get(text) ?? syncSha(text)
  // G store bodies: distinct snapshots whose stable keys hash (through shaMap) to the registered keySha256.
  const template = fixture().input.buildListEntries[0]!
  const refs = d2dReverificationCandidates(d)
  const gStoreBodies = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  refs.forEach((r, n) => {
    const snapshot = { ...structuredClone(template.candidateSnapshot), seriesSkillId: `series_skill.variant.${n}`, searchRunId: r.searchIdentity }
    shaMap.set(candidateStableKey(snapshot), r.keySha256)
    gStoreBodies.set(r.file, { bytes: r.bytes, sha256: r.sha256, body: { ...structuredClone(template), id: r.generatedBuildListEntryId, targetWeaponId: r.targetWeaponId, calculationContext: { ...D2D_CALCULATION_CONTEXT },
      isStale: false, candidateSnapshot: snapshot } })
  })
  // Export support bodies hashing (through shaMap) to the CTX supportBodySha256.
  const exportEntries = v.supports.map((s, i) => {
    const body = { id: s.supportBuildListEntryId, targetWeaponId: `target.outside.${i}` }
    shaMap.set(stableStringify(body), s.contexts[0]!.supportBodySha256)
    return body
  })
  const rvRecord = { ...CTXV, result: { status: 'verified', unitId: 'RV', baseline: { conflictResolutions: 0, maxPlanSteps: 20_000 }, issues: [],
    candidates: refs.map(r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, generatedBuildListEntryId: r.generatedBuildListEntryId,
      generatedEntry: { file: r.file, sha256Observed: r.sha256 }, RV1: { bodySha256Matched: true, idMatched: true, targetMatched: true, calculationContextMatched: true, notStale: true, searchRunIdMatched: true, keySha256Matched: true },
      RV2: { status: 'not_recomputed', replacedBuildListEntryId: null, satisfied: null },
      RV3: { reservationSource: r.origin === 'd2b_k0' ? 'k0_empty' : 'ctx_record', reservationDigest: r.origin === 'd2b_k0' ? D2D_K0_RESERVATION_DIGEST : r.poolReservationDigest, matched: true, issues: [] },
      RV4: { respects: true, blockedHits: { normal: [], gogma: [], skill: [] }, exclusiveHit: [] }, satisfied: true })),
    supports: v.supports.map(s => ({ supportBuildListEntryId: s.supportBuildListEntryId, contextRecords: s.contexts.map(c => c.k), RV5: { expected: s.contexts.map(c => c.supportBodySha256), observed: s.contexts[0]!.supportBodySha256, exportBodies: 1, matched: true },
      RV6: { digestExpected: s.contexts.map(c => c.reservationDigest), digestObserved: s.contexts[0]!.reservationDigest, digestMatched: true, bodyObserved: structuredClone(s.contexts[0]!.reservationBody), bodyMatched: true, satisfied: true } })) } }
  const rvRow: D2DRvRow = { unitId: 'RV', status: 'verified', notExecutedReason: null, process: PROC('00'), recordFile: { file: 'RV.record.json', bytes: 1, sha256: 'r' } }

  const evaluationRows: D2DEvaluationRow[] = [], evaluationRecords = new Map<string, Json | null>()
  const ctxOf = (s: string) => v.supports.find(x => x.supportBuildListEntryId === s)!.contexts[0]!
  const evalOf = (id: string, stage: 'B0' | 'I0' | 'PAIR', set: D2DDerivedSet | null, o: Outcome) => {
    const reps: D2DCandidateRef[] = set?.replacements ?? []
    const generated = reps.map(r => r.generatedBuildListEntryId)
    const support = set?.requiresSupport ?? []
    const digest = d1InputDigest(reps.map(r => r.targetWeaponId), generated, reps.map(r => r.sha256), EXPORT)
    const row: D2DEvaluationRow = { evaluationId: id, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : 'replacement_set', pairOrdinal: set?.pairOrdinal ?? null, t05Ordinal: set?.t05Ordinal ?? null,
      t07Ordinal: set?.t07Ordinal ?? null, replacementLabels: reps.map(r => r.label), replacementTargets: reps.map(r => r.targetWeaponId), generatedEntryIds: generated, generatedEntrySha256s: reps.map(r => r.sha256),
      requiresSupport: support, inputDigest: digest, registeredInputDigest: set?.registeredInputDigest ?? D2D_B0_EXPECTED.inputDigest, status: 'evaluated', notExecutedReason: null, process: PROC('01'),
      recordFile: { file: `${id}.record.json`, bytes: 1, sha256: 'r' }, runner: null }
    evaluationRows.push(row)
    if (o.timeout) { Object.assign(row, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1, startedAt: PROC('01').startedAt }, recordFile: null }); return null }
    const notSelected = new Set(o.notSelected ?? [])
    const selected = [...generated, ...support, ...['build-list.other.1', 'build-list.other.2']].filter(x => !notSelected.has(x)).sort()
    const conflicts = (o.conflicts ?? Array.from({ length: stage === 'B0' ? 21 : 20 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] }))).map((c, i) => ({ id: `c${i}`, kind: 'same_skill_counter',
      participants: [...c.participants].sort(), selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: (c as { resourceIdentity?: string | null }).resourceIdentity ?? null, resourceIdentityMatched: (c as { resourceIdentity?: string | null }).resourceIdentity != null }))
    const staticChecks = Object.fromEntries(support.map(s => [s, { S4: true, S5: { digestExpected: ctxOf(s).reservationDigest, digestObserved: ctxOf(s).reservationDigest, digestMatched: true,
      bodyExpected: structuredClone(ctxOf(s).reservationBody), bodyObserved: structuredClone(ctxOf(s).reservationBody), bodyMatched: true, satisfied: true } }]))
    const targetOf = new Map(reps.map(r => [r.generatedBuildListEntryId, r.targetWeaponId]))
    const facts = { preflight: { status: stage === 'B0' ? 'not_run' : 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
      plan: { present: true, termination: { status: o.termination ?? 'exhausted', completedTargetCount: o.completed ?? (stage === 'B0' ? 20 : 23), totalTargetCount: o.total ?? 43, reachedLimits: [] }, steps: 1465,
        selectedBuildListEntryIds: selected, warningKinds: [] },
      conflicts, routeCommitment: generated.map(g => ({ buildListEntryId: g, role: 'generated', status: notSelected.has(g) ? 'not_committed' : 'committed', provisionalOutcomeSelectedBuildListEntryId: notSelected.has(g) ? 'winner.x' : null,
        rejectionReasons: [] })),
      supportChecks: Object.fromEntries(support.map(s => [s, { S1: true, S2: true, S3: true, S4: true, S5: true }])), trialRunSummary: null, trialVerdict: null,
      baselineSummary: stage === 'B0' ? structuredClone(SUMMARY) : null, steps: [], resultDigest: '', rejectedBuildListEntries: [], resourceConflictRejections: 0,
      selectedTargetWeaponIds: [...new Set(selected.map(x => targetOf.get(x) ?? `other:${x}`))].sort(), supportStaticChecks: staticChecks,
      supportBodySha256Observed: Object.fromEntries(support.map(s => [s, ctxOf(s).supportBodySha256])), childRecheck: { checked: reps.length, issues: [] } }
    facts.resultDigest = d1ResultDigest(facts as unknown as D2EvaluationFacts)
    evaluationRecords.set(id, { ...CTXV, inputDigest: digest, result: { status: o.status ?? 'evaluated', ...facts } })
    return facts
  }
  const b0 = evalOf('B0', 'B0', null, outcomes.B0 ?? {})
  const i0 = evalOf('I0', 'I0', d.i0, outcomes.I0 ?? {})
  for (const p of d.pairs) evalOf(p.evaluationId, 'PAIR', p, outcomes[p.evaluationId] ?? {})
  // The synthetic B0 / I0 results are the parity expectations of this synthetic run (the real ones are registered constants).
  const exp = (f: typeof b0, base: NonNullable<D2DValidatedInputs['expected']>['b0']) => f === null ? base : { ...base, resultDigest: f.resultDigest }
  v.expected = { b0: exp(b0, v.expected!.b0), i0: exp(i0, v.expected!.i0) }
  v.priorByInputDigest = { [D2D_B0_EXPECTED.inputDigest]: [{ source: 'D2', evaluationId: 'B0', status: 'evaluated', resultDigest: b0?.resultDigest ?? 'x' }],
    [D2D_I0_EXPECTED.inputDigest]: [{ source: 'D2-C', evaluationId: 'CMP-t10-c1', status: 'evaluated', resultDigest: i0?.resultDigest ?? 'x' }] }
  const input: Synthetic['input'] = { validated: v, exportSha256: EXPORT, exportBuildListEntries: exportEntries, baselineBuildListEntries: null, gStoreBodies, rvRow, rvRecord, evaluationRows, evaluationRecords,
    interrupted: false, runEnvelopeReached: false, abortReason: null, provenanceIssues: [], evidenceIssues: [], rawConsistencyIssues: [], childProcessCount: 9, sha256OfText: sha }
  return { input, v, shaMap }
}
const analyze = (s: Synthetic, over: Partial<D2DAnalysisInput> = {}) => analyzeD2DRun({ ...s.input, ...over })
const pairIds = () => validateD2DInputs(realEvidence()).derivation!.pairs.map(p => p.evaluationId)
const gOf = (pairIndex: number, label: string) => validateD2DInputs(realEvidence()).derivation!.pairs[pairIndex]!.replacements.find(r => r.label === label)!.generatedBuildListEntryId
const states = (r: ReturnType<typeof analyze>) => Object.fromEntries(r.parityChecks.map(c => [c.checkId, c.state]))
const categories = (r: ReturnType<typeof analyze>) => r.invalidReasons.map(x => x.category)

describe('D2-D run analysis (§5 - §11)', () => {
  it('replays a clean run: every parity matched, PAIR-1 keeps the Skill 485 collision, an improved PAIR decides EXCEEDS', () => {
    const P = pairIds()
    const t05 = gOf(0, 't05'), t07 = gOf(0, 't07')
    const s = synthetic({
      [P[0]!]: { notSelected: [t07], conflicts: [{ participants: [t05, t07], resourceIdentity: SKILL485 }, ...Array.from({ length: 19 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] }))] },
      [P[1]!]: { completed: 22 },
      [P[2]!]: { completed: 24, conflicts: Array.from({ length: 19 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] })) },
      [P[3]!]: { completed: 23 },
      [P[4]!]: { completed: 24, conflicts: Array.from({ length: 21 }, (_, i) => ({ participants: [`x${i}a`, `x${i}b`] })) },
      [P[5]!]: { notSelected: [gOf(5, 't05')] },
    })
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(Object.values(states(r)).every(x => x === 'matched' || x === 'not_applicable')).toBe(true)
    expect(states(r)).toMatchObject({ 'baseline:B0': 'matched', 'd2c_final:I0': 'matched', 'd2c_context:CTX-1': 'matched', 'd2c_context:CTX-7': 'matched', [`registered_input:${P[0]}`]: 'matched' })
    expect(r.rv).toMatchObject({ status: 'verified', satisfied: true })
    expect(r.decision).toMatchObject({ case: 'D2D_EXCEEDS_D2C_FINAL', bestEligiblePair: P[2], bestImprovedPair: P[2], improvedPairs: [P[2], P[4]], r5OnlyEligiblePairs: [P[1]],
      equalMetricsPairs: [P[3]], pairCoexistencePairs: [P[1], P[2], P[3], P[4]], r5SatisfiedPairs: [P[1], P[2], P[3], P[4]] })
    expect(r.decision.vsD2cFinal).toMatchObject({ subjectEvaluationId: P[2], completedDelta: 1, conflictDelta: -1, better: true })
    const p1 = r.evaluations.find(e => e.evaluationId === P[0])!
    expect(p1.r5).toMatchObject({ satisfied: false, failureReasons: [`generated_not_selected:${t07}`, 'conflict_within_set'] })
    expect(p1.pair).toMatchObject({ pairCoexistence: false, t07: { selected: false, winnerBuildListEntryId: 'winner.x' }, d2cT05ResourcesObserved: [{ resourceIdentity: SKILL485, observed: true }] })
    expect(r.d2cKnownComparison[0]).toMatchObject({ pairEvaluationId: P[0], d2cEvaluationId: 'CMP-t05-c1', sameStructuralOutcome: true, d2d: { skill485Conflict: true, t07Selected: false } })
    expect(r.pairs.ranking.map(x => x.rank)).toEqual([null, null, 1, 3, 2, null])
    expect(r.aggregates.childProcesses).toEqual({ registeredMax: 9, started: 9 })
  })

  it('decides SET_COEXISTENT_NOT_BETTER (equal or regressed) and NO_SET_COEXISTENCE (pairCoexistence alone is not R5)', () => {
    const P = pairIds()
    const sup = validateD2DInputs(realEvidence()).supports[0]!.supportBuildListEntryId
    const allBad = Object.fromEntries(P.map((id, i) => [id, { notSelected: i === 0 ? [sup] : [gOf(i, 't07')] }]))
    const none = analyze(synthetic(allBad))
    expect(none.decision).toMatchObject({ case: 'D2D_NO_SET_COEXISTENCE', pairCoexistencePairs: [P[0]], pairCoexistentButSetNotCoexistentPairs: [P[0]], r5SatisfiedPairs: [] })
    const eq = analyze(synthetic({ ...allBad, [P[3]!]: {} }))
    expect(eq.decision).toMatchObject({ case: 'D2D_SET_COEXISTENT_NOT_BETTER', equalMetricsPairs: [P[3]], bestEligiblePair: P[3], bestImprovedPair: null })
  })

  it('decides GLOBAL_COMPLETE_R only with 43 / 43, Conflict 0 and R5', () => {
    const P = pairIds()
    const r = analyze(synthetic({ [P[2]!]: { completed: 43, termination: 'completed', conflicts: [] } }))
    expect(r.decision.case).toBe('D2D_GLOBAL_COMPLETE_R')
    expect(r.aggregates.r6).toMatchObject({ satisfied: 1, satisfiedEvaluationIds: [P[2]] })
  })

  it('reads timeout / not_executed as unmeasured (INCOMPLETE, a lower bound), never as non-coexistence', () => {
    const P = pairIds()
    const r = analyze(synthetic({ [P[1]!]: { timeout: true }, [P[2]!]: { completed: 24, conflicts: [] } }))
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2D_INCOMPLETE', lowerBound: true, unmeasuredEvaluations: [P[1]], exceedsD2cObservedUnderIncomplete: true })
    expect(states(r)[`registered_input:${P[1]}`]).toBe('not_checked')
    // An unmeasured I0 leaves every PAIR not_executed (i0_unmeasured).
    const s = synthetic({ I0: { timeout: true } })
    for (const row of s.input.evaluationRows.filter(x => x.stage === 'PAIR')) { Object.assign(row, { status: 'not_executed', notExecutedReason: 'i0_unmeasured', process: null, recordFile: null }); s.input.evaluationRecords.delete(row.evaluationId) }
    const i0 = analyze(s, { childProcessCount: 3 })
    expect(i0.invalidReasons).toEqual([])
    expect(i0.decision).toMatchObject({ case: 'D2D_INCOMPLETE', unmeasuredEvaluations: ['I0', ...P] })
    expect(states(i0)['d2c_final:I0']).toBe('not_checked')
  })

  it('makes an unmeasured RV leave every evaluation not_executed (rv_unmeasured) and the CTX parity not_checked', () => {
    const s = synthetic()
    Object.assign(s.input.rvRow!, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1 }, recordFile: null })
    for (const row of s.input.evaluationRows) { Object.assign(row, { status: 'not_executed', notExecutedReason: 'rv_unmeasured', process: null, recordFile: null }); s.input.evaluationRecords.delete(row.evaluationId) }
    const r = analyze(s, { rvRecord: null, childProcessCount: 1 })
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2D_INCOMPLETE', unmeasuredEvaluations: ['RV', 'B0', 'I0', ...pairIds()] })
    expect(states(r)['d2c_context:CTX-6']).toBe('not_checked')
  })

  it('makes a B0 / I0 parity mismatch, a tampered RV, an S5 failure, a child inputDigest mismatch and a missing record INVALID', () => {
    const P = pairIds()
    const mutate = (fn: (s: Synthetic) => void, over: Partial<D2DAnalysisInput> = {}) => { const s = synthetic(); fn(s); return analyze(s, over) }
    const fact = (s: Synthetic, id: string) => (s.input.evaluationRecords.get(id)!.result as Json)
    const redigest = (s: Synthetic, id: string) => { const f = fact(s, id); f.resultDigest = d1ResultDigest(f as unknown as D2EvaluationFacts) }
    expect(categories(mutate(s => { (fact(s, 'B0').plan as Json).steps = 1466; redigest(s, 'B0') }))).toContain('baseline_parity_mismatch')
    expect(categories(mutate(s => { fact(s, 'I0').conflicts = []; redigest(s, 'I0') }))).toContain('d2c_parity')
    expect(categories(mutate(s => { ((s.input.rvRecord!.result as Json).candidates as Json[])[0]!.RV4 = { respects: false, blockedHits: { skill: [485] }, exclusiveHit: [] } }))).toContain('guardrail')
    expect(categories(mutate(s => { const st = fact(s, P[0]!).supportStaticChecks as Record<string, Json>; (Object.values(st)[0]!.S5 as Json).bodyMatched = false }))).toContain('guardrail')
    expect(states(mutate(s => { s.input.evaluationRecords.get(P[2]!)!.inputDigest = 'fnv1a32:00000000' }))[`registered_input:${P[2]}`]).toBe('mismatched')
    expect(categories(mutate(s => { s.input.evaluationRecords.set(P[4]!, null) }))).toContain('evidence_integrity')
    expect(categories(mutate(s => { ((s.input.rvRecord!.result as Json).supports as Json[])[0]!.RV6 = { digestObserved: 'fnv1a32:00000000', digestMatched: true, bodyObserved: {}, bodyMatched: true } }))).toEqual(expect.arrayContaining(['d2c_parity', 'guardrail']))
    expect(categories(mutate(s => { s.input.evaluationRows.splice(3, 1) }))).toEqual(expect.arrayContaining(['evidence_integrity', 'guardrail']))
    expect(mutate(() => undefined, { abortReason: 'x' }).decision.case).toBe('D2D_INVALID')
  })
})

// ---------------------------------------------------------------- isolation, sources and Production (§9.2 / §9.3)

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

describe('D2-D oracle isolation, sources and Production (§9.2 / §9.3 / G37 - G43)', () => {
  it('reaches no oracle, Phase B analysis, population-authority or Phase 2-C2.5-D2-D module', () => {
    for (const entry of ['./plannerGlobalD2D.ts', './plannerGlobalD2DAnalysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalD2C.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound|Phase2C25D2D/.test(f))).toEqual([])
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD2C.ts', '/src/benchmarks/plannerGlobalD2D.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD2D.ts', '/src/benchmarks/plannerGlobalD2DAnalysis.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts'])
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|_1657_|PHASE2C25D2D|d2d-pair-smoke/)
  })

  it('hard-codes no Target, Entry or stable key; every fnv1a32 digest in the code is a registered one', () => {
    const v = validateD2DInputs(realEvidence())
    const ids = [...v.derivation!.final, ...v.derivation!.p07, ...v.derivation!.p05].flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.generatedBuildListEntryId, r.searchIdentity, r.keySha256])
    const registered = new Set([D2D_K0_RESERVATION_DIGEST, D2D_REGISTERED_INPUT_DIGESTS.I0, ...D2D_REGISTERED_INPUT_DIGESTS.pairs, D2D_B0_EXPECTED.inputDigest, D2D_B0_EXPECTED.resultDigest, D2D_I0_EXPECTED.resultDigest])
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|build-list\.(constrained\.)?fnv1a32|planner-alternative-search\.fnv1a32/)
      for (const id of ids) expect(source).not.toContain(id.replace(/^(build-list\.(constrained\.)?|planner-alternative-search\.)/, '').slice(0, 16))
      for (const m of source.matchAll(/fnv1a32:[0-9a-f]{8}/g)) expect(registered.has(m[0])).toBe(true)
    }
  })

  it('runs no Search, discovery, materialization or ADM and writes no resolution, lineage or selected Entry (G1 / G30 / G37)', () => {
    for (const source of [mainSource, analysisSource]) {
      expect(codeOnly(source)).not.toMatch(/visitPlannerAlternativeCandidates|createPlannerAlternativeMaterializer|runD2CDiscoveryUnit|prepareD2CContextRecord|judgePlannerAlternativeTrial|runPlannerAlternativeKernel/)
      expect(codeOnly(source)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|mergePlannerConflictScenarioResolution|selectedBuildListEntryId:\s*'/)
    }
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, targetWeaponId, \[\]\)/)
    expect(codeOnly(runnerSource)).not.toMatch(/'discover'|'context'|'admit'/)
  })

  it('is never imported by Production, changes no D2-C / D2 / D1 / Phase B module, and counts Production source changes by the registered rule', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2D/.test(source)).map(([path]) => path)).toEqual([])
    // Only the D2-D files themselves may reference the D2-D modules, by exact path (never a `D2D` substring of the path: Phase
    // 2-C2.5-D2-D, `plannerGlobalPhase2C25D2D*`, is another Research item, D2-D-A §9.4).
    const allowed = ['./plannerGlobalD2D.ts', './plannerGlobalD2DAnalysis.ts', './plannerGlobalD2D.test.ts']
    // An import of a D2-D module (static, dynamic or ?raw). Allowlists naming the D2-D paths as strings (the D2-C test) are not imports.
    const D2D_IMPORT = /(?:from\s+|import\s*\(\s*)['"]\.\/plannerGlobalD2D(?:Analysis)?(?:\.ts)?(?:\?raw)?['"]/
    const illegalD2DReferences = (sources: Record<string, string>) => Object.entries(sources).filter(([path, source]) => !allowed.includes(path) && D2D_IMPORT.test(source)).map(([path]) => path)
    expect(illegalD2DReferences(benchmarkSources)).toEqual([])
    expect(allowed.filter(path => /Phase2C25D2D/.test(path))).toEqual([])
    // Every allowed path is a real file (the glob never lists the importing test file itself).
    for (const path of allowed.filter(x => x !== './plannerGlobalD2D.test.ts')) expect(benchmarkSources[path], path).toBeDefined()
    const phase2c25d2d = Object.keys(benchmarkSources).filter(path => /^\.\/plannerGlobalPhase2C25D2D/.test(path))
    expect(phase2c25d2d.length).toBeGreaterThan(0)
    for (const path of phase2c25d2d) {
      expect(illegalD2DReferences({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { runD2DEvaluation } from './plannerGlobalD2D'\n` })).toEqual([path])
      expect(illegalD2DReferences({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { analyzeD2DRun } from './plannerGlobalD2DAnalysis'\n` })).toEqual([path])
    }
    // The new D2-D modules themselves must not reach Phase 2-C2.5-D2-D either (D2-D-A §9.4).
    for (const path of allowed.filter(x => x !== './plannerGlobalD2D.test.ts')) expect(benchmarkSources[path], path).not.toMatch(/from '\.\/plannerGlobalPhase2C25D2D/)
    expect(d2dProductionChangedFiles(['src/benchmarks/plannerGlobalD2D.ts', 'scripts/run-planner-global-d2d.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d2dProductionChangedFiles(['src/domain/planner/x.ts'])).toEqual(['src/domain/planner/x.ts'])
  })

  it('builds the RV task (12 Candidates, 3 supports) and the evaluation tasks (K1 own CTX record) from V only', () => {
    const v = validateD2DInputs(realEvidence())
    const rv = d2dReverificationTask(v)
    expect(rv.candidates.map(c => `${c.label}c${c.ordinal}`)).toEqual(['t00c1', 't01c1', 't04c1', 't05c1', 't05c2', 't06c3', 't07c1', 't07c2', 't07c3', 't08c1', 't09c1', 't10c1'])
    expect(rv.candidates.filter(c => c.origin === 'd2b_k0').every(c => c.k1 === null)).toBe(true)
    expect(rv.candidates.filter(c => c.origin === 'd2c_k1').map(c => c.k1!.k)).toEqual([1, 5, 6, 6, 7])
    expect(rv.supports.map(s => s.contexts.length)).toEqual([1, 1, 2])
    const pair = v.derivation!.pairs[2]!
    const task = d2dEvaluationTask(v, pair.evaluationId, 'PAIR', 3, pair.replacements)
    expect(task.replacements.map(r => r.generatedBuildListEntryId)).toEqual(pair.generatedBuildListEntryIds)
    expect(task.replacements.filter(r => r.requiresSupport.length > 0).every(r => typeof r.supportReservation === 'object' && r.supportReservation !== null && r.supportBodySha256 !== null)).toBe(true)
    expect(task).toMatchObject({ stage: 'PAIR', evaluatedAgainst: 'replacement_set', pairOrdinal: 3, researchMaxPlanSteps: 20_000, fullRunCap: 8 })
  })

  it('writes every §11 required RESULT field in the analyzer', () => {
    for (const field of ['phase:', 'analyzedAt:', 'sources:', 'specDocument:', 'd2c:', 'generatedEntriesUsed:', 'contextRecordsUsed:', 'attestation:', 'raw:', 'd2:', 'phase2c2Result:', 'export:', 'documents:',
      'd2d:', 'rvRecord:', 'records', 'provenance:', 'formal,', 'measuredHead,', 'analysisHead,', 'measuredHeadIsAncestor,', 'runStatus,', 'benchmarkCodeSha256,', 'registeredPolicySha256,',
      'calculationCodeChangedSinceMeasuredHead,', 'productionChangedFiles:', 'toMeasuredHead:', 'toAnalysisHead:', 'startAttestation:', 'd2cMeasuredHead:', 'd2MeasuredHead:', 'D2D_PROVENANCE_FLAGS',
      'd2cResultFieldsRead:', 'd2ResultFieldsRead:', 'contextRecordFieldsRead', 'd2cResultModified:', 'd2ResultModified:', 'environment:', 'conditions:', 'fixedCandidates:', 't07Candidates:', 't05Candidates:',
      'pairs:', 'derivationRule:', 'order:', 'i0Rule:', 'pairRule:', 'r5Definition:', 'pairCoexistenceDefinition:', 'gate:', 'betterRule:', 'improvedRule:', 'selectionOrder:', 'r6Definition:', 'rvChecks:',
      'supportChecks:', 'supportExpiryCauses:', 'budgets:', 'executionEnvelope:', 'researchMaxPlanSteps:', 'evaluationFullRunCap:', 'decisionRule:', 'comparisonBaselines:', 'notRun:', 'inputValidation:',
      'derivedPairs:', 'rv:', 'evaluations:', 'parityChecks:', 'd2cKnownComparison:', 'comparison:', 'aggregates:', 'timing:', 'rvWallMs:', 'runEnvelopeReached:', 'memory:', 'invalidReasons:', 'decision:']) {
      expect(analyzerSource).toContain(field)
    }
    for (const flag of ['oracleReadByRunner', 'oracleReadByChild', 'oracleReadByAnalyzer', 'd2cResultModified', 'd2ResultModified', 'priorEvidenceReusedAsResult', 'oracleGuidedTargetPopulation', 'newSearchInD2D',
      'newCandidateDiscoveryInD2D', 'newAdmissionInD2D', 'speculativeSupportWrittenAsResolution', 'alternativeToAlternativeSupport', 'productionSemanticsChanged']) expect(mainSource).toContain(`${flag}:`)
    const r = analyze(synthetic())
    expect(Object.keys(r).sort()).toEqual(['aggregates', 'comparison', 'd2cKnownComparison', 'decision', 'evaluations', 'invalidReasons', 'pairs', 'parityChecks', 'rv', 'unmeasured'])
    expect(Object.keys(r.decision).sort()).toEqual(['bestEligiblePair', 'bestImprovedPair', 'boundLimitedEvaluations', 'case', 'conflictIncreasedPairs', 'eligiblePairs', 'equalMetricsPairs',
      'exceedsD2cObservedUnderIncomplete', 'globalCompleteObservedUnderIncomplete', 'improvedPairs', 'lowerBound', 'pairCoexistencePairs', 'pairCoexistentButSetNotCoexistentPairs', 'r5OnlyEligiblePairs',
      'r5SatisfiedPairs', 'reasons', 'setCoexistenceObservedUnderIncomplete', 'unmeasuredEvaluations', 'vsBaseline', 'vsD2bMain', 'vsD2cFinal'])
    for (const e of r.evaluations) for (const k of ['stage', 'pairOrdinal', 't05Ordinal', 't07Ordinal', 'registeredInputDigest', 'inputDigestMatched', 'rejectedBuildListEntries', 'resourceConflictRejections',
      'selectedTargetWeaponIds', 'conflicts', 'referenceDiff', 'baselineDiff', 'r5', 'pair', 'gate', 'r5OnlyEligible', 'eligible', 'improved', 'equalMetrics', 'conflictIncreased', 'supportChecksByEntry', 'r6',
      'priorParity', 'inputDigest', 'resultDigest']) expect(e).toHaveProperty(k)
    for (const c of r.rv.candidates) for (const k of ['label', 'ordinal', 'origin', 'contextId', 'generatedBuildListEntryId', 'generatedEntry', 'RV1', 'RV2', 'RV3', 'RV4', 'satisfied']) expect(c).toHaveProperty(k)
    for (const k of ['ranking', 'bestEligiblePair', 'bestImprovedPair']) expect(r.pairs).toHaveProperty(k)
    expect(r.comparison.byPair).toHaveLength(6)
    for (const k of ['evaluations', 'childProcesses', 'fullPlannerRunsStarted', 'runtimeUnsupportedRetries', 'r5', 'pairCoexistence', 'r6', 'boundLimitedEvaluations', 'supportOutcomes',
      'determinismCrossChecks', 'parity']) expect(r.aggregates).toHaveProperty(k)
    expect(hashStableValue({})).toMatch(/^fnv1a32:/)
  })
})

// ---------------------------------------------------------------- start attestation (§9.2)

const DOCS = Object.fromEntries(D2D_CHAINED_DOCUMENT_KEYS.map(k => [k, D2C.sources.documents[k].sha256 as string]))
const observation = () => ({ createdAt: '2026-10-11T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d2d.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D2D_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes, sha256: v.sha256 ?? EXPORT_SHA }])),
  observedDocuments: Object.fromEntries(D2D_CHAINED_DOCUMENT_KEYS.map(k => [k, { bytes: 1, sha256: DOCS[k]! }])),
  observedGStoreFiles: Object.fromEntries(D2D_G_STORE_FILES.map(f => [d2dGStoreKey(f.label, f.ordinal), { bytes: f.bytes, sha256: f.sha256 }])),
  observedContextRecords: Object.fromEntries(D2D_CONTEXT_RECORDS.map(c => [String(c.k), { bytes: c.bytes, sha256: c.sha256 }])),
  exportFileName: D2D_REGISTERED_INPUTS.export.file, productionAudit: { baseMain: D2D_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 }, appliedExecutionEnvelope: { ...D2D_EXECUTION_ENVELOPE }, rngEngineVersion: 'production-rng:c5-e7',
  observedCalculationContext: { ...D2D_CALCULATION_CONTEXT }, smoke: null })
const expectation: Parameters<typeof verifyD2DStartAttestation>[1] = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64), exportSha256: EXPORT_SHA, chainedDocuments: DOCS, firstChildStartedAt: '2026-10-11T00:00:01.000Z' }

describe('D2-D start attestation', () => {
  it('verifies a clean formal launch and fails on any drift', () => {
    const verify = (patch: object, exp = expectation) => verifyD2DStartAttestation(JSON.parse(JSON.stringify({ ...d2dStartAttestationBody(observation()), ...patch })), exp)
    expect(verify({})).toEqual({ verified: true, issues: [] })
    expect(verify({ productionAudit: { baseMain: D2D_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { pairs: [1], maxChildren: null, budgetMs: null, skipEvaluations: false } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ budgets: { ...D2D_BUDGETS, pairEvaluations: 7 } }).issues).toContain('budgets differs from the registered condition')
    expect(verify({ appliedExecutionEnvelope: { ...D2D_EXECUTION_ENVELOPE, runBudgetMs: 1 } }).verified).toBe(false)
    expect(verify({ rngEngineVersion: 'production-rng:c5-e8' }).verified).toBe(false)
    expect(verify({ observedGStoreFiles: {} }).verified).toBe(false)
    expect(verify({ observedContextRecords: {} }).verified).toBe(false)
    expect(verify({}, { ...expectation, exportSha256: null }).issues).toContain('the observed export is not the registered input')
    expect(verify({}, { ...expectation, chainedDocuments: { ...DOCS, d1a: 'f'.repeat(64) } }).issues).toContain('the observed document d1a is not the chained document')
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-10T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
