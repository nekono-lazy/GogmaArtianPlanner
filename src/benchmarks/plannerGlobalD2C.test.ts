import { beforeEach, describe, expect, it, vi } from 'vitest'
import d2ResultRaw from '../../docs/PLANNER_GLOBAL_D2_RESULT.json?raw'
import phaseBResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import d1Document from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md?raw'
import d2Document from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md?raw'
import d2bDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2B.md?raw'
import d2cDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d2c.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d2c.mjs?raw'
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
import { d1InputDigest, d1ResultDigest, parseD1SpecTables } from './plannerGlobalD1'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { PHASE2C27B_LADDER, PHASE2C27B_POPULATION_AUTHORITY } from './plannerGlobalPhase2C27B'
import type { D2EvaluationFacts } from './plannerGlobalD2'
import mainSource from './plannerGlobalD2C.ts?raw'
import analysisSource from './plannerGlobalD2CAnalysis.ts?raw'
import {
  d2cContextId,
  d2cContextParity,
  d2cDiscoveryNext,
  d2cI0Parity,
  d2cPhaseBK1PrefixParity,
  d2cProductionChangedFiles,
  d2cRegisteredConditions,
  d2cRegisteredPolicySha256,
  d2cRungExtent,
  d2cStartAttestationBody,
  d2cSupportExpiryCause,
  deriveD2CContexts,
  parseD2CSpecContextTable,
  prepareD2CContextRecord,
  projectD2CD2Result,
  projectD2CPhaseBRecordReservation,
  projectD2CPhaseBResult,
  projectD2CPhaseBTask,
  readD2CContextRecord,
  runD2CDiscoveryUnit,
  runD2CEvaluation,
  validateD2CInputs,
  verifyD2CStartAttestation,
  D2CDiscoveryScheduler,
  D2C_BASE_MAIN,
  D2C_BUDGETS,
  D2C_CALCULATION_CONTEXT,
  D2C_EXECUTION_ENVELOPE,
  D2C_I0_FILES,
  D2C_K1_POOL_CAP,
  D2C_LADDER,
  D2C_PHASE_B_UNITS,
  D2C_REGISTERED_INPUTS,
  type D2CContext,
  type D2CContextTask,
  type D2CDiscoveryTask,
  type D2CEvaluationTask,
  type D2CInputEvidence,
  type D2CReplacementTask,
  type D2CValidatedInputs,
} from './plannerGlobalD2C'
import { analyzeD2CRun, classifyD2CDecision, type D2CAnalysisInput, type D2CContextRow, type D2CDiscoveryRow, type D2CEvaluationRow } from './plannerGlobalD2CAnalysis'

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const codeOnly = (source: string) => source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
const fakeSha = (seed: string) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i * 7 + seed.length) % 16]).join('')
/** A synchronous 64-hex digest for the synthetic records (eight seeded FNV-1a 32-bit passes over the whole text; collision-free for the test keys). */
const syncSha = (text: string) => Array.from({ length: 8 }, (_, seed) => {
  let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}).join('')
const lf = (text: string) => text.replace(/\r\n/g, '\n')

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

// ---------------------------------------------------------------- registered conditions (D2-C-A §2 - §13)

describe('D2-C registered conditions', () => {
  it('registers the committed inputs by their SHA-256 and every value the D2-C document names', async () => {
    expect(await sha256(d2ResultRaw)).toBe(D2C_REGISTERED_INPUTS.d2Result.sha256)
    expect(await sha256(phaseBResultRaw)).toBe(D2C_REGISTERED_INPUTS.phaseBResult.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D2C_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(lf(d1Document))).toBe(D2C_REGISTERED_INPUTS.d1SpecDocument.sha256)
    expect(await sha256(lf(d2Document))).toBe(D2C_REGISTERED_INPUTS.d2SpecDocument.sha256)
    expect(await sha256(lf(d2bDocument))).toBe(D2C_REGISTERED_INPUTS.d2bDocument.sha256)
    const spec = lf(d2cDocument)
    for (const f of D2C_I0_FILES) expect(spec).toContain(f.sha256)
    for (const u of D2C_PHASE_B_UNITS) { expect(spec).toContain(u.taskSha256); expect(spec).toContain(u.recordSha256) }
    expect(D2C_REGISTERED_INPUTS.export.sha256).toBeNull()
    expect(D2C_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
  })

  it('fixes the ladder, the caps, the budgets and the envelope as D2-C-A registers them', () => {
    expect(D2C_LADDER.map(r => [r.id, r.extent])).toEqual(PHASE2C27B_LADDER.map(r => [r.id, r.extent]))
    expect(D2C_LADDER.map(r => [r.extent.maxNormalAdvance, r.extent.maxGogmaAdvance, r.extent.maxSkillAdvance])).toEqual([[4, 235, 4], [8, 235, 256], [128, 235, 1500]])
    expect(D2C_K1_POOL_CAP).toBe(2)
    expect(D2C_BUDGETS).toMatchObject({ contexts: 7, contextChildren: 7, discoveryUnitsMax: 21, uniqueCandidatesMax: 14, deliveriesPerUnitMax: 5, b0Evaluations: 1, i0Evaluations: 1,
      admissionEvaluationsMax: 14, compositionEvaluationsMax: 14, evaluationRequestsMax: 30, childProcessesMax: 58, evaluationFullRunCap: 8, researchMaxPlanSteps: 20_000 })
    expect(D2C_EXECUTION_ENVELOPE).toEqual({ contextUnitBudgetMs: 600_000, discoveryUnitBudgetMs: 3_600_000, evaluationBudgetMs: 1_800_000, discoveryEnvelopeMs: 32_400_000, runBudgetMs: 43_200_000,
      childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none', memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D2C_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    const spec = lf(d2cDocument)
    expect(spec).toContain('`K1_POOL_CAP = 2`')
    expect(spec).toMatch(/評価リクエスト合計 \| B0 1 \+ I0 1 \+ ADM ≤ 14 \+ CMP ≤ 14 = \*\*30以下\*\*/)
    expect(spec).toMatch(/child process合計 \| CTX 7 \+ DSC ≤ 21 \+ 評価 ≤ 30 = \*\*58以下\*\*/)
    expect(d2cRegisteredPolicySha256(syncSha)).toBe(d2cRegisteredPolicySha256(syncSha))
    expect(d2cRegisteredConditions().selectionOrder).toEqual(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
  })

  it('reads only the allowlisted D2 / Phase B RESULT, task and record fields', () => {
    const d2 = projectD2CD2Result(JSON.parse(d2ResultRaw))!
    expect(d2.evaluations.map(e => e.stage).filter(s => !['B0', 'ADM', 'CMP', 'Z'].includes(s))).toEqual([])
    expect(d2.sources.generatedEntries.map(g => g.file).sort()).toEqual(D2C_I0_FILES.map(f => f.file).sort())
    expect(Object.keys(d2.evaluations[0]!).sort()).toEqual(['b0Conflicts', 'candidates', 'conflictCount', 'evaluationId', 'generatedEntryIds', 'generatedEntrySha256s', 'inputDigest', 'r1', 'r5Satisfied',
      'resultDigest', 'selectedBuildListEntryIds', 'stage', 'status', 'steps', 'targetLabel', 'termination'])
    const phaseB = projectD2CPhaseBResult(JSON.parse(phaseBResultRaw))!
    expect(JSON.stringify(phaseB)).not.toMatch(/oracle|covering|exactRecovered/i)
    expect(phaseB.units.map(u => u.unitId).sort()).toEqual(D2C_PHASE_B_UNITS.map(u => u.unitId).sort())
    expect(phaseB.sources.unitRecords).toHaveLength(10)
    expect(Object.keys(projectD2CPhaseBTask({ unitId: 'u', secret: 1 })!).sort()).toEqual(['cardinality', 'contextRank', 'currentBuildListEntryId', 'extent', 'reservationDigest', 'rung',
      'supportBuildListEntryIds', 'targetIndex', 'targetWeaponId', 'unitId'])
    expect(projectD2CPhaseBRecordReservation({ result: { reservation: { a: 1 }, trials: [{ secret: 1 }] } })).toEqual({ a: 1 })
    expect(projectD2CPhaseBRecordReservation({ result: { reservation: 'text' } })).toBeNull()
  })
})

// ---------------------------------------------------------------- V and the §3.1 derivation (§3 / §10.1)

const TABLE = parseD2CSpecContextTable(lf(d2cDocument))
const OUTSIDE = (id: string) => `target.outside.${id.slice(-8)}`

/** The real committed inputs plus a manifest, Export Entries, I0 bodies and Phase B task / record stand-ins rebuilt from them. */
function realEvidence(): D2CInputEvidence {
  const d2 = JSON.parse(d2ResultRaw)
  const phaseB = JSON.parse(phaseBResultRaw)
  const exportSha = phaseB.sources.export.sha256 as string
  const ids = parseD1SpecTables(d1Document).found.map(r => r.targetWeaponId)
  const files = Object.fromEntries(Object.entries(D2C_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? exportSha }])) as D2CInputEvidence['files']
  const discovery = d2.discovery.targets as { label: string; targetWeaponId: string; currentBuildListEntryId: string }[]
  const finalAccepted = d2.composition.main.finalAccepted as { label: string; generatedBuildListEntryId: string }[]
  const supports = [...new Set(TABLE.map(r => r.supportBuildListEntryId))]
  const phaseBUnits = projectD2CPhaseBResult(phaseB)!.units
  const taskOf = (unitId: string) => {
    const row = TABLE.find(r => r.phaseBUnitIds.includes(unitId))!
    const rung = unitId.slice(-2) as 'L0' | 'L1'
    return { unitId, targetWeaponId: row.targetWeaponId, targetIndex: Number(row.label.slice(1)), contextRank: phaseBUnits.find(u => u.unitId === unitId)!.contextRank, rung, extent: d2cRungExtent(rung),
      cardinality: 1, supportBuildListEntryIds: [row.supportBuildListEntryId], reservationDigest: row.registeredReservationDigest, currentBuildListEntryId: row.currentBuildListEntryId, secret: 'never read' }
  }
  return {
    files,
    manifest: { phase: 'manifest', population: 'E1', b2c2b1ResultSha256: PHASE2C27B_POPULATION_AUTHORITY.b2c2b1ResultSha256, b2c1ResultSha256: PHASE2C27B_POPULATION_AUTHORITY.b2c1ResultSha256,
      exportSha256: exportSha, oracleGuidedTargetPopulation: true, targetWeaponIds: ids },
    d2Result: d2, phaseBResult: phaseB, phase2c2Result: JSON.parse(phase2c2ResultRaw),
    i0Files: Object.fromEntries(D2C_I0_FILES.map((f, i) => [f.file, { file: { bytes: f.bytes, sha256: f.sha256 }, json: { id: finalAccepted[i]!.generatedBuildListEntryId,
      targetWeaponId: discovery.find(t => t.label === f.label)!.targetWeaponId } }])),
    phaseBTasks: Object.fromEntries(D2C_PHASE_B_UNITS.map(u => [u.unitId, { file: { bytes: u.taskBytes, sha256: u.taskSha256 }, json: taskOf(u.unitId) }])),
    phaseBRecords: Object.fromEntries(D2C_PHASE_B_UNITS.map(u => [u.unitId, { file: { bytes: u.recordBytes, sha256: u.recordSha256 }, json: { result: { reservation: { stand: u.unitId.slice(0, 3) }, trials: [] } } }])),
    exportBuildListEntries: [...discovery.map(t => ({ id: t.currentBuildListEntryId, targetWeaponId: t.targetWeaponId })), ...supports.map(id => ({ id, targetWeaponId: OUTSIDE(id) }))],
    specMarkdown: lf(d2cDocument), d1SpecMarkdown: lf(d1Document),
  }
}

describe('D2-C V: the 6 Targets / 7 contexts re-derived from the D2 RESULT (§3.1 / §3.2 / §10.1)', () => {
  it('derives exactly the §3.2 contexts, order and observation counts from the D2 RESULT winners', () => {
    const v = validateD2CInputs(realEvidence())
    expect(v.issues).toEqual([])
    expect(v.scopeTargets.map(t => t.label)).toEqual(['t00', 't02', 't03', 't04', 't05', 't10'])
    expect(v.contexts.map(c => [c.k, c.contextId, c.observations, c.observedEvaluations, c.orderInTarget])).toEqual(TABLE.map(r => [r.k, r.contextId, r.observations, r.observedEvaluations, r.orderInTarget]))
    expect(v.contexts.map(c => `${c.label}:${c.observations}/${c.observedEvaluations}`)).toEqual(['t00:9/9', 't02:6/6', 't03:6/9', 't03:3/9', 't04:9/9', 't05:9/9', 't10:9/9'])
    expect(v.contexts.map(c => c.phaseBUnits.map(u => u.unitId).length)).toEqual([1, 2, 2, 2, 2, 0, 1])
    expect(v.contexts.map(c => c.registeredReservationDigest === null)).toEqual([false, false, false, false, false, true, false])
    expect(v.contexts.every(c => c.b0Selected === true && c.d2bFinalSelected === true)).toBe(true)
    expect(v.scopeTargets.map(t => t.d2bK0Pool.length)).toEqual([3, 2, 3, 3, 3, 3])
    expect(v.i0.map(x => [x.label, x.ordinal])).toEqual([['t01', 1], ['t06', 3], ['t07', 1], ['t08', 1], ['t09', 1]])
    expect(v.d2?.i0).toMatchObject({ evaluationId: 'CMP-t09-c1', completed: 22, totalTargetCount: 43, conflicts: 20, steps: 1465, termination: 'exhausted' })
    expect(v.d2?.byInputDigest[v.d2.i0.inputDigest]?.map(x => x.evaluationId)).toEqual(['CMP-t09-c1'])
    // Co-participants never become a support: the winners alone are counted.
    expect(v.derivation!.winners.flatMap(w => w.winners.map(x => x.buildListEntryId)).sort()).toEqual([...new Set(TABLE.map(r => r.supportBuildListEntryId))].flatMap(id => TABLE.filter(r => r.supportBuildListEntryId === id).map(() => id)).sort())
  })

  it('derives mechanically: the winner order is (count desc, Entry ID asc) and an ineligible winner is skipped', () => {
    const e = realEvidence()
    const d2 = projectD2CD2Result(e.d2Result)!
    const ids = (e.manifest as { targetWeaponIds: string[] }).targetWeaponIds
    const t03 = TABLE.filter(r => r.label === 't03')
    const inside = e.exportBuildListEntries.map(x => (x as { id: string }).id === t03[0]!.supportBuildListEntryId ? { ...x as object, targetWeaponId: ids[1] } : x)
    const derived = deriveD2CContexts(d2, inside, ids)
    expect(derived.contexts.filter(c => c.label === 't03').map(c => c.supportBuildListEntryId)).toEqual([t03[1]!.supportBuildListEntryId])
    expect(derived.winners.find(w => w.label === 't03')!.winners[0]).toMatchObject({ eligible: false, ineligibleReasons: ['its Target is not outside E1'] })
  })

  const failing = (mutate: (e: D2CInputEvidence) => void) => {
    const e = realEvidence()
    mutate(e)
    const v = validateD2CInputs(e)
    expect(v.passed).toBe(false)
    expect(v.contexts).toEqual([])
    return v.issues.join(';')
  }

  it('fails closed on a missing file, a digest / byte mismatch, a broken Export chain or a changed D2 RESULT, never substituting a value', () => {
    expect(failing(e => { e.files.phaseBTargets = null })).toMatch(/phaseBTargets: .* is missing/)
    expect(failing(e => { e.files.d2Result = { bytes: 4_122_806, sha256: '0'.repeat(64) } })).toMatch(/d2Result: SHA-256/)
    expect(failing(e => { e.files.export = { bytes: 19_424_064, sha256: '1'.repeat(64) } })).toMatch(/export: SHA-256/)
    expect(failing(e => { (e.manifest as { exportSha256: string }).exportSha256 = '2'.repeat(64) })).toMatch(/the manifest Export is not the chained Export/)
    expect(failing(e => { (e.d2Result as { decision: { case: string } }).decision.case = 'D2A_INCOMPLETE' })).toMatch(/decision.case is not D2A_EXCEEDS_D1_INCUMBENT/)
    expect(failing(e => { ((e.d2Result as { evaluations: { evaluationId: string; status: string }[] }).evaluations.find(x => x.evaluationId === 'CMP-t03-c1')!.status = 'timeout') }))
      .toMatch(/CMP-t03-c1: a source evaluation that is not evaluated/)
    expect(failing(e => { ((e.d2Result as { evaluations: { evaluationId: string; resultDigest: string }[] }).evaluations.find(x => x.evaluationId === 'CMP-t09-c1')!.resultDigest = 'fnv1a32:00000000') }))
      .toMatch(/CMP-t09-c1 digests are not the ones the D2-C document names/)
  })

  it('fails closed when the derivation and the §3.2 table disagree (observations, order, support)', () => {
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| t00 | `02876df4', '| t00 | `02876df4').replace(/\| 9 \/ 9 \| 1 \| `t00-r09-L0`/, '| 8 / 9 | 1 | `t00-r09-L0`') }))
      .toMatch(/the §3.1 derivation is not the §3.2 table row 1/)
    expect(failing(e => {
      const d2 = e.d2Result as { evaluations: { evaluationId: string; candidates: { label: string; winnerBuildListEntryId: string }[] }[] }
      const c = d2.evaluations.find(x => x.evaluationId === 'ADM-t03-c1')!.candidates.find(x => x.label === 't03')!
      c.winnerBuildListEntryId = TABLE[3]!.supportBuildListEntryId
    })).toMatch(/K1-t03-.*: the §3.1 derivation is not the §3.2 table/)
  })

  it('fails closed on a missing / changed I0 body, Phase B task or record', () => {
    expect(failing(e => { e.i0Files['t06-c3.generated-entry.json'] = null })).toMatch(/t06-c3.generated-entry.json: the D2-B G store file is missing/)
    expect(failing(e => { (e.i0Files['t07-c1.generated-entry.json']!.json as { id: string }).id = 'other' })).toMatch(/t07-c1.generated-entry.json: the body is not the D2-B final accepted G/)
    expect(failing(e => { e.phaseBTasks['t02-r10-L1'] = null })).toMatch(/t02-r10-L1: the Phase B task \/ record file is missing/)
    expect(failing(e => { e.phaseBRecords['t04-r43-L0']!.file = { bytes: 1, sha256: '3'.repeat(64) } })).toMatch(/t04-r43-L0: the record file is not the registered one/)
    expect(failing(e => { (e.phaseBTasks['t10-r10-L0']!.json as { reservationDigest: string }).reservationDigest = 'fnv1a32:00000000' })).toMatch(/t10-r10-L0: the task reservation digest is not the §3.2 registered digest/)
    expect(failing(e => { (e.phaseBRecords['t00-r09-L0']!.json as { result: { reservation: unknown } }).result.reservation = '{"normal":[]}' })).toMatch(/t00-r09-L0: the record has no result.reservation object/)
  })
})

// ---------------------------------------------------------------- CTX / DSC / evaluation children on the Fake RNG Engine fixture (§4 / §5 / §7)

const TARGET_A = 'target.d2c.a', TARGET_B = 'target.d2c.b'
const ENTRY_A = 'build-list.d2c.a' as BuildListEntryId, ENTRY_B = 'build-list.d2c.b' as BuildListEntryId
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source'
const nodeSha = (text: string) => syncSha(text)

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

function contextTask(over: Partial<D2CContextTask> = {}): D2CContextTask {
  return { unitId: 'CTX-1', contextId: d2cContextId('t00', ENTRY_A), k: 1, label: 't00', targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B, supportBuildListEntryId: ENTRY_A,
    e1TargetWeaponIds: E1, e1CurrentBuildListEntryIds: E1_O, registeredReservationDigest: null, phaseBReservations: [], researchMaxPlanSteps: 20_000, ...over }
}
function context(built = fixture(), over: Partial<D2CContextTask> = {}) {
  const input = research(built)
  return prepareD2CContextRecord(input, derivePhase2C26B2C1Schedule(input, built.dependencies), input.buildListEntries, contextTask(over), built.dependencies, nodeSha)
}
function discoveryTask(built: OrchestrationScenario, over: Partial<D2CDiscoveryTask> = {}): D2CDiscoveryTask {
  const ctx = JSON.parse(JSON.stringify(context(built)))
  return { unitId: 'DSC-1-L0', contextId: d2cContextId('t00', ENTRY_A), k: 1, label: 't00', targetWeaponId: TARGET_B, supportBuildListEntryId: ENTRY_A, currentBuildListEntryId: ENTRY_B,
    rung: 'L0', extent: d2cRungExtent('L0'), context: { recordSha256: 'r', reservationBody: ctx.reservationBody, reservationDigest: ctx.reservationDigest, originDigest: ctx.originDigest, excludedRouteKeys: ctx.excludedRouteKeys },
    poolKeysAtStart: [], d2bK0Pool: [], poolCap: 2, researchMaxPlanSteps: 20_000, ...over }
}
const discover = async (over: Partial<D2CDiscoveryTask> = {}) => {
  const built = fixture()
  return { built, unit: await runD2CDiscoveryUnit(research(built), discoveryTask(built, over), built.dependencies, { sha256OfText: nodeSha }) }
}

describe('D2-C CTX: the context record and C1 .. C5 (§4.1 / §7.1)', () => {
  it('records the reservation as a JSON object with its digest, the support body SHA-256 and C1 .. C4', () => {
    const built = fixture()
    const r = context(built)
    expect(r.status).toBe('context_ready')
    expect(r.checks).toMatchObject({ C1: { satisfied: true }, C2: { satisfied: true }, C3: { satisfied: true }, C4: { satisfied: true }, C5: { state: 'not_applicable' } })
    expect(typeof r.reservationBody).toBe('object')
    expect(r.reservationDigest).toBe(hashStableValue(r.reservationBody))
    expect(r.checks.C3.referencedOwnedWeaponIds).toEqual([ORCHESTRATION_SOURCE_A])
    expect(r.checks.C3.exclusiveOwnedWeaponIds).toContain(ORCHESTRATION_SOURCE_A)
    expect(r.supportBodySha256).toBe(nodeSha(stableStringify(built.input.buildListEntries.find(e => e.id === ENTRY_A))))
    expect(r.excludedRouteKeys).toEqual([candidateStableKey(built.input.buildListEntries.find(e => e.id === ENTRY_B)!.candidateSnapshot)])
    // The record written as JSON and read back keeps reservationBody an object (never a string).
    const read = readD2CContextRecord(JSON.parse(JSON.stringify({ result: r })))
    expect(read.issue).toBeNull()
    expect(stableStringify(read.record!.reservationBody)).toBe(stableStringify(r.reservationBody))
    expect(readD2CContextRecord({ result: { ...r, reservationBody: stableStringify(r.reservationBody) } }).issue).toMatch(/reservationBody is string, not a JSON object/)
    expect(readD2CContextRecord({ result: { ...r, reservationBody: null } }).issue).toMatch(/null/)
  })

  it('judges C5 against the registered digest and every Phase B record body (both objects), not_applicable without a registered digest', () => {
    const r = context()
    const body = JSON.parse(JSON.stringify(r.reservationBody))
    const ok = context(fixture(), { registeredReservationDigest: r.reservationDigest, phaseBReservations: [{ unitId: 'pb-L0', reservation: body }, { unitId: 'pb-L1', reservation: body }] })
    expect(ok.checks.C5).toEqual({ state: 'matched', expectedDigest: r.reservationDigest, digestMatched: true, phaseBUnitIds: ['pb-L0', 'pb-L1'], bodyMatched: [true, true] })
    const otherBody = context(fixture(), { registeredReservationDigest: r.reservationDigest, phaseBReservations: [{ unitId: 'pb-L0', reservation: { ...body, exclusiveOwnedWeaponIds: ['x'] } }] })
    expect(otherBody.checks.C5).toMatchObject({ state: 'mismatched', digestMatched: true, bodyMatched: [false] })
    expect(context(fixture(), { registeredReservationDigest: 'fnv1a32:00000000', phaseBReservations: [{ unitId: 'pb', reservation: body }] }).checks.C5).toMatchObject({ state: 'mismatched', digestMatched: false })
    // A string body never matches (no double serialization).
    expect(d2cContextParity(body, r.reservationDigest, r.reservationDigest, [{ unitId: 'pb', reservation: stableStringify(body) }]).state).toBe('mismatched')
  })

  it('fails C1 .. C4 as a guardrail violation (support inside E1, a generated support, the Target own Entry, a wrong O_t)', () => {
    expect(context(fixture(), { e1TargetWeaponIds: [TARGET_A, ...E1.slice(1)] })).toMatchObject({ status: 'guardrail_violation', checks: { C1: { satisfied: false } } })
    expect(context(fixture(), { e1CurrentBuildListEntryIds: [ENTRY_A, ...E1_O.slice(1)] }).checks.C1.issues).toContain('the support Entry is an E1 O_t')
    expect(context(fixture(), { supportBuildListEntryId: ENTRY_B, contextId: d2cContextId('t00', ENTRY_B) })).toMatchObject({ status: 'guardrail_violation', checks: { C2: { satisfied: false } } })
    expect(context(fixture(), { currentBuildListEntryId: ENTRY_A })).toMatchObject({ status: 'guardrail_violation', checks: { C2: { satisfied: false } } })
  })
})

describe('D2-C DSC: K1 discovery, cap 2 and D-1 .. D-4 (§4.2 - §4.5)', () => {
  it('pools at most K1_POOL_CAP = 2 Candidates materialized against the baseline with the context reservation, no trial', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error(JSON.stringify(unit))
    expect(unit.pooled.map(p => p.indexInContext)).toEqual([1, 2])
    expect(unit.deliveries.map(d => d.action)).toEqual(['pooled', 'pooled'])
    const ctx = context(built)
    for (const p of unit.pooled) {
      expect(p.reusedExisting).toBe(false)
      expect(p.replacement).toEqual({ status: 'ready', replacedBuildListEntryId: ENTRY_B })
      expect(p.reservationDigest).toBe(ctx.reservationDigest)
      expect(p.r0.respects).toBe(true)
      expect(candidateStableKey(p.generatedEntry!.candidateSnapshot)).toBe(p.candidateStableKey)
      expect(p.generatedEntry!.candidateSnapshot.searchRunId).toBe(p.searchIdentity)
      expect(p.keySha256).toBe(nodeSha(p.candidateStableKey))
    }
    expect(unit.observedContext).toMatchObject({ reservationDigest: ctx.reservationDigest, originDigest: ctx.originDigest, currentBuildListEntryId: ENTRY_B })
    expect(preflightSpy.calls).toEqual([])
  })

  it('classifies a lower-rung key as duplicate_of_lower_rung (D-2) and a D2-B K0 pool key as same_key_as_d2b_k0_pool (D-4)', async () => {
    const first = (await discover()).unit
    if (first.status !== 'discovery_cap_reached') throw new Error('fixture')
    const [k1, k2] = first.pooled.map(p => p.candidateStableKey)
    const d2 = (await discover({ unitId: 'DSC-1-L1', rung: 'L1', extent: d2cRungExtent('L1'), poolKeysAtStart: [k1!] })).unit
    if (!('deliveries' in d2)) throw new Error(JSON.stringify(d2))
    expect(d2.deliveries.map(d => d.action)).toEqual(['duplicate_of_lower_rung', 'pooled'])
    expect(d2.pooled.map(p => [p.indexInContext, p.candidateStableKey])).toEqual([[2, k2]])
    // One pooled key of an earlier rung (never delivered again here) leaves room for one: the D2-B K0 key is skipped, the next one pooled.
    const d4 = (await discover({ unitId: 'DSC-1-L1', rung: 'L1', extent: d2cRungExtent('L1'), poolKeysAtStart: ['an earlier key'], d2bK0Pool: [{ ordinal: 3, keySha256: nodeSha(k1!) }] })).unit
    if (d4.status !== 'discovery_cap_reached') throw new Error(JSON.stringify(d4))
    expect(d4.deliveries.map(d => [d.action, d.d2bK0Ordinal])).toEqual([['same_key_as_d2b_k0_pool', 3], ['pooled', null]])
    expect(d4.pooled.map(p => [p.indexInContext, p.candidateStableKey])).toEqual([[2, k2]])
  })

  it('fails a context drift (reservation body / digest / origin / excluded keys differ from the CTX record) as a guardrail violation', async () => {
    const built = fixture()
    const task = discoveryTask(built)
    const drift = async (over: Partial<D2CDiscoveryTask['context']>) => runD2CDiscoveryUnit(research(built), { ...task, context: { ...task.context, ...over } }, built.dependencies, { sha256OfText: nodeSha })
    expect(await drift({ reservationBody: { ...task.context.reservationBody, exclusiveOwnedWeaponIds: [] } })).toMatchObject({ status: 'guardrail_violation', issues: ['context_drift: the reservation body differs from the CTX record'] })
    expect((await drift({ reservationDigest: 'fnv1a32:00000000' })).status).toBe('guardrail_violation')
    expect((await drift({ originDigest: 'o' })).status).toBe('guardrail_violation')
    expect((await drift({ excludedRouteKeys: [] })).status).toBe('guardrail_violation')
    expect((await drift({ reservationBody: stableStringify(task.context.reservationBody) as never })).status).toBe('guardrail_violation')
    expect((await runD2CDiscoveryUnit(research(built), { ...task, extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 } }, built.dependencies, { sha256OfText: nodeSha })).status).toBe('guardrail_violation')
  })

  it('runs rung-major: L0 for every context, then L1 / L2 only for contexts that stopped by extent below the cap', () => {
    const s = new D2CDiscoveryScheduler([1, 2, 3, 4], k => k !== 3)
    const seen: string[] = []
    const outcome: Record<string, ['discovery_cap_reached' | 'stopped_by_search_extent_bound' | 'discovery_exhausted' | 'ladder_exhausted' | 'timeout', number]> = {
      '1-L0': ['stopped_by_search_extent_bound', 0], '2-L0': ['discovery_cap_reached', 2], '4-L0': ['stopped_by_search_extent_bound', 1],
      '1-L1': ['stopped_by_search_extent_bound', 1], '4-L1': ['timeout', 1], '1-L2': ['ladder_exhausted', 1] }
    for (const item of s.items()) {
      seen.push(`${item.k}-${item.rung}${item.dependency ? '*' : ''}`)
      const [status, pool] = outcome[`${item.k}-${item.rung}`] ?? ['discovery_exhausted', 0]
      s.report(item.k, item.rung, item.dependency ? 'not_executed' : status, pool)
    }
    expect(seen).toEqual(['1-L0', '2-L0', '3-L0*', '4-L0', '1-L1', '3-L1*', '4-L1', '1-L2', '3-L2*'])
    expect([1, 2, 3, 4].map(k => s.stop(k))).toEqual(['ladder_exhausted', 'discovery_cap_reached', 'not_executed', 'unmeasured'])
    expect(d2cDiscoveryNext('stopped_by_search_extent_bound', 'L0', 1)).toEqual({ next: 'L1', stop: null })
    expect(() => d2cDiscoveryNext('stopped_by_search_extent_bound', 'L0', 2)).toThrow(/full pool/)
    for (const st of ['timeout', 'out_of_memory', 'process_failure', 'interrupted', 'discovery_calculation_error', 'guardrail_violation'] as const) expect(d2cDiscoveryNext(st, 'L0', 0)).toEqual({ next: null, stop: 'unmeasured' })
    expect(d2cDiscoveryNext('not_executed', 'L1', 0)).toEqual({ next: null, stop: 'not_executed' })
  })
})

const replacementOf = (entry: BuildListEntry, current: string, support: string[] = [], over: Partial<D2CReplacementTask> = {}): D2CReplacementTask => ({ targetIndex: 0, targetWeaponId: entry.targetWeaponId,
  currentBuildListEntryId: current, generatedBuildListEntryId: entry.id, generatedEntrySha256: 'sha', generatedEntryFile: 'g.json', requiresSupport: support, contextId: support.length ? 'K1' : null,
  supportReservationDigest: null, supportReservation: null, supportBodySha256: null, ...over })
const evalTask = (stage: D2CEvaluationTask['stage'], replacements: D2CReplacementTask[]): D2CEvaluationTask => ({ evaluationId: stage, stage,
  evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', replacements, researchMaxPlanSteps: 20_000, fullRunCap: 8 })

describe('D2-C evaluations: S4 / S5 against the CTX record, G1, G15 (§5 / §7.2)', () => {
  it('runs an ADM of a K1 Candidate with the CTX record digest and body object; S1 .. S5 hold, found_R is a diagnostic, no fixed constraint', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const ctx = JSON.parse(JSON.stringify(context(built)))
    const g = unit.pooled[0]!.generatedEntry!
    const task = evalTask('ADM', [replacementOf(g, ENTRY_B, [ENTRY_A], { supportReservationDigest: ctx.reservationDigest, supportReservation: ctx.reservationBody, supportBodySha256: ctx.supportBodySha256 })])
    const r = await runD2CEvaluation(research(built), built.input.buildListEntries, task, [g], built.dependencies, { sha256OfText: nodeSha })
    if (r.status !== 'evaluated') throw new Error(JSON.stringify(r))
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    expect(r.runConflictResolutions).toBe(0)
    expect(r.supportChecks[ENTRY_A]).toEqual({ S1: true, S2: true, S3: true, S4: true, S5: true })
    expect(r.supportStaticChecks[ENTRY_A]!.S5).toMatchObject({ digestExpected: ctx.reservationDigest, digestObserved: ctx.reservationDigest, digestMatched: true, bodyMatched: true, satisfied: true })
    expect(r.supportStaticChecks[ENTRY_A]!.S5.bodyExpected).toEqual(ctx.reservationBody)
    expect(r.supportBodySha256Observed).toEqual({ [ENTRY_A]: ctx.supportBodySha256 })
    expect(['found_R', 'rejected']).toContain(r.trialVerdict?.status)
    expect(r.resultDigest).toBe(d1ResultDigest(r))
  })

  it('fails S4 (SHA-256 / body) and S5 (digest / body, a string body) statically, and G15 (two Candidates of one Target)', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const ctx = JSON.parse(JSON.stringify(context(built)))
    const [g1, g2] = [unit.pooled[0]!.generatedEntry!, unit.pooled[1]!.generatedEntry!]
    const run = (over: Partial<D2CReplacementTask>, entries = built.input.buildListEntries as unknown[]) => runD2CEvaluation(research(built), entries,
      evalTask('ADM', [replacementOf(g1, ENTRY_B, [ENTRY_A], { supportReservationDigest: ctx.reservationDigest, supportReservation: ctx.reservationBody, supportBodySha256: ctx.supportBodySha256, ...over })]), [g1], built.dependencies, { sha256OfText: nodeSha })
    expect(await run({ supportBodySha256: '0'.repeat(64) })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S4: .* supportBodySha256/)] })
    expect(await run({ supportReservationDigest: 'fnv1a32:00000000' })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S5: .* digest/)] })
    expect(await run({ supportReservation: { ...ctx.reservationBody, exclusiveOwnedWeaponIds: [] } })).toMatchObject({ status: 'guardrail_violation', issues: [expect.stringMatching(/^S5: .* result.reservation/)] })
    expect(await run({ supportReservation: stableStringify(ctx.reservationBody) as never })).toMatchObject({ status: 'guardrail_violation', issues: ['S5: the support reservation body is not a JSON object'] })
    const changed = built.input.buildListEntries.map(e => e.id === ENTRY_A ? { ...e, memo: 'changed' } : e)
    expect((await run({ supportBodySha256: nodeSha(stableStringify(changed.find(e => e.id === ENTRY_A))) }, changed)).status).toBe('guardrail_violation')
    const two = await runD2CEvaluation(research(built), built.input.buildListEntries, evalTask('CMP', [replacementOf(g1, ENTRY_B), replacementOf(g2, ENTRY_B)]), [g1, g2], built.dependencies, { sha256OfText: nodeSha })
    expect(two).toMatchObject({ status: 'guardrail_violation' })
    expect(preflightSpy.calls).toEqual([])
  })

  it('evaluates I0 as one replacement_set run without the found_R diagnostic (the D2 Z0 procedure) and B0 as the persisted baseline', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const g = unit.pooled[0]!.generatedEntry!
    const i0 = await runD2CEvaluation(research(built), built.input.buildListEntries, evalTask('I0', [replacementOf(g, ENTRY_B)]), [g], built.dependencies, { sha256OfText: nodeSha })
    expect(i0.status === 'evaluated' && i0.trialVerdict === null && i0.supportBodySha256Observed !== undefined).toBe(true)
    const b0 = await runD2CEvaluation(research(built), built.input.buildListEntries, evalTask('B0', []), [], built.dependencies, { sha256OfText: nodeSha })
    expect(b0.status === 'evaluated' && b0.baselineSummary !== null && b0.preflight.status === 'not_run').toBe(true)
  })

  it('names the support expiry cause top to bottom (§7.3): dynamic S1 .. S3 expire, not selected is not an expiry, S4 / S5 are static', () => {
    const ok = { S1: true, S2: true, S3: true, S4: true, S5: true }
    expect(d2cSupportExpiryCause(ok, true, false)).toBeNull()
    expect(d2cSupportExpiryCause({ ...ok, S1: false, S2: false }, false, true)).toBe('support_target_replaced')
    expect(d2cSupportExpiryCause({ ...ok, S2: false }, false, true)).toBe('support_removed_runtime_unsupported')
    expect(d2cSupportExpiryCause({ ...ok, S2: false }, false, false)).toBe('support_entry_absent')
    expect(d2cSupportExpiryCause({ ...ok, S3: false }, true, false)).toBe('support_entry_invalid')
    expect(d2cSupportExpiryCause(ok, false, false)).toBe('support_not_selected')
    expect(d2cSupportExpiryCause({ ...ok, S4: false }, true, false)).toBe('support_body_mismatch')
    expect(d2cSupportExpiryCause({ ...ok, S5: false }, true, false)).toBe('support_reservation_mismatch')
  })
})

// ---------------------------------------------------------------- parity primitives (§9)

describe('D2-C parity primitives (§9)', () => {
  it('gives the Phase B K1 prefix its four states', () => {
    expect(d2cPhaseBK1PrefixParity({ comparable: true, status: 'stopped_by_search_extent_bound', deliveredCandidates: 0 }).state).toBe('matched')
    expect(d2cPhaseBK1PrefixParity({ comparable: true, status: 'stopped_by_search_extent_bound', deliveredCandidates: 1 }).state).toBe('mismatched')
    expect(d2cPhaseBK1PrefixParity({ comparable: true, status: 'discovery_cap_reached', deliveredCandidates: 2 }).state).toBe('mismatched')
    expect(d2cPhaseBK1PrefixParity({ comparable: true, status: 'discovery_exhausted', deliveredCandidates: 0 }).state).toBe('mismatched')
    expect(d2cPhaseBK1PrefixParity({ comparable: true, status: 'discovery_calculation_error', deliveredCandidates: null }).state).toBe('mismatched')
    expect(d2cPhaseBK1PrefixParity({ comparable: false, status: 'timeout', deliveredCandidates: null }).state).toBe('not_checked')
  })

  it('checks I0 against the D2-B CMP-t09-c1 values', () => {
    const expected = { evaluationId: 'CMP-t09-c1', inputDigest: 'i', resultDigest: 'r', completed: 22, totalTargetCount: 43, conflicts: 20, steps: 1465, termination: 'exhausted' }
    const ok = { status: 'evaluated', inputDigest: 'i', resultDigest: 'r', termination: 'exhausted', completed: 22, totalTargetCount: 43, conflicts: 20, steps: 1465, r5Satisfied: true }
    expect(d2cI0Parity(expected, ok)).toEqual([])
    expect(d2cI0Parity(expected, { ...ok, conflicts: 21 })).toEqual(['Conflicts'])
    expect(d2cI0Parity(expected, { ...ok, status: 'preflight_refused', r5Satisfied: false })).toEqual(['status preflight_refused', 'R5 is not satisfied'])
    expect(d2cI0Parity(expected, { ...ok, resultDigest: 'x' })).toEqual(['resultDigest'])
  })
})

// ---------------------------------------------------------------- the run analysis (a synthetic run: t00 with one context, t03 with two)

const EXPORT = 'e'.repeat(64)
const T = ['target.d2c.t0', 'target.d2c.t1', 'target.d2c.t2', 'target.d2c.t3']
const O = ['entry.d2c.o0', 'entry.d2c.o1', 'entry.d2c.o2', 'entry.d2c.o3']
const SUP1 = 'entry.d2c-sup00001', SUP2 = 'entry.d2c-sup00002'
const G_I0 = 'entry.d2c.gi0', GSHA_I0 = fakeSha('gi0')
const CTXV = { calculationContext: { ...D2C_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000 }
const SUMMARY = { planningTargetCount: 43, completedTargetCount: 20, termination: 'exhausted', planSteps: 1, selectedTargets: [], conflicts: 21, conflictsByKind: {}, conflictSignatures: [] }
const PROC = (at: string) => ({ outcome: 'completed', wallMs: 1, startedAt: `2026-10-11T00:00:${at}.000Z` })

interface Synthetic {
  validated: D2CValidatedInputs
  exportEntries: unknown[]
  contextRows: D2CContextRow[]
  contextRecords: Map<string, Record<string, unknown> | null>
  discoveryRows: D2CDiscoveryRow[]
  discoveryRecords: Map<string, Record<string, unknown> | null>
  poolFiles: Map<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: D2CEvaluationRow[]
  evaluationRecords: Map<string, Record<string, unknown> | null>
  res: Record<string, Record<string, unknown>>
}

function synthetic(): Synthetic {
  const built = fixture()
  const [entryA, entryB] = built.input.buildListEntries as BuildListEntry[]
  const body = (base: BuildListEntry, id: string, target: string) => ({ ...structuredClone(base), id, targetWeaponId: target })
  const exportEntries: Record<string, unknown>[] = [body(entryB!, O[0]!, T[0]!), body(entryB!, O[1]!, T[1]!), body(entryB!, O[2]!, T[2]!), body(entryB!, O[3]!, T[3]!),
    body(entryA!, SUP1, 'target.outside.1'), body(entryB!, SUP2, 'target.outside.2')]
  const oKey = (i: number) => candidateStableKey((exportEntries[i] as unknown as BuildListEntry).candidateSnapshot)
  const RES1 = { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [10], blocked: [10] }, exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_A] }
  const RES2 = { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [11], blocked: [11] }, exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_B] }
  const support: Record<string, { body: Record<string, unknown>; res: Record<string, unknown>; src: string }> = { [SUP1]: { body: exportEntries[4]!, res: RES1, src: ORCHESTRATION_SOURCE_A }, [SUP2]: { body: exportEntries[5]!, res: RES2, src: ORCHESTRATION_SOURCE_B } }
  const ctxDefs = [{ k: 1, label: 't00', t: 0, sup: SUP1, registered: false }, { k: 2, label: 't03', t: 3, sup: SUP1, registered: true }, { k: 3, label: 't03', t: 3, sup: SUP2, registered: false }]
  const contexts: D2CContext[] = ctxDefs.map((d, i) => ({ contextId: d2cContextId(d.label, d.sup), label: d.label, targetIndex: d.t, targetWeaponId: T[d.t]!, currentBuildListEntryId: O[d.t]!,
    supportBuildListEntryId: d.sup, supportTargetWeaponId: (support[d.sup]!.body as { targetWeaponId: string }).targetWeaponId, observations: 3, observedEvaluations: 3, orderInTarget: d.k === 3 ? 2 : 1,
    b0Selected: true, d2bFinalSelected: true, k: d.k, registeredReservationDigest: d.registered ? hashStableValue(support[d.sup]!.res) : null,
    phaseBUnits: d.registered ? [{ unitId: 't03-r10-L0', rung: 'L0', contextRank: 10, taskReservationDigest: hashStableValue(support[d.sup]!.res), recordReservation: structuredClone(support[d.sup]!.res) }] : [],
    d2bK0Pool: d.label === 't03' ? [{ ordinal: 2, keySha256: '' }] : [], b0SupportConflicts: [], ...(i < 0 ? {} : {}) }))
  // Candidate keys from snapshot variants.
  const variant = (n: number) => ({ ...structuredClone(entryA!.candidateSnapshot), seriesSkillId: `series_skill.variant.${n}` })
  const keyOf = (n: number) => candidateStableKey(variant(n))
  const [KA, KB, KC, KD, KE] = [1, 2, 3, 4, 5].map(keyOf)
  contexts[1]!.d2bK0Pool = [{ ordinal: 2, keySha256: syncSha(KE!) }]
  contexts[2]!.d2bK0Pool = [{ ordinal: 2, keySha256: syncSha(KE!) }]
  const validated: D2CValidatedInputs = { passed: true, issues: [], exportSha256: EXPORT, e1TargetWeaponIds: T, e1CurrentBuildListEntryIds: O,
    scopeTargets: [{ label: 't00', targetIndex: 0, targetWeaponId: T[0]!, currentBuildListEntryId: O[0]!, contextIds: [contexts[0]!.contextId], d2bK0Pool: [] },
      { label: 't03', targetIndex: 3, targetWeaponId: T[3]!, currentBuildListEntryId: O[3]!, contextIds: [contexts[1]!.contextId, contexts[2]!.contextId], d2bK0Pool: [{ ordinal: 2, keySha256: syncSha(KE!) }] }],
    contexts, i0: [{ label: 't01', targetIndex: 1, targetWeaponId: T[1]!, currentBuildListEntryId: O[1]!, ordinal: 1, file: 't01-c1.generated-entry.json', bytes: 1, sha256: GSHA_I0, generatedBuildListEntryId: G_I0 }],
    d2: null, phase2c2BaselineSummary: SUMMARY, derivation: null }

  // CTX
  const contextRows: D2CContextRow[] = [], contextRecords = new Map<string, Record<string, unknown> | null>()
  for (const c of contexts) {
    const s = support[c.supportBuildListEntryId]!
    const key = oKey(c.targetIndex)
    const reservationDigest = hashStableValue(s.res)
    const result = { status: 'context_ready', unitId: `CTX-${c.k}`, contextId: c.contextId, k: c.k, label: c.label, targetWeaponId: c.targetWeaponId, currentBuildListEntryId: c.currentBuildListEntryId,
      supportBuildListEntryId: c.supportBuildListEntryId, supportTargetWeaponId: c.supportTargetWeaponId, supportBodySha256: syncSha(stableStringify(s.body)), reservationBody: structuredClone(s.res), reservationDigest,
      originDigest: 'o', scheduleOriginDigest: 'o', excludedRouteKeys: [key], excludedRouteKeySha256s: [syncSha(key)], scheduleExcludedRouteKeys: [key], conflictContextCount: 0,
      checks: { C1: { satisfied: true, issues: [] }, C2: { satisfied: true, issues: [] }, C3: { satisfied: true, referencedOwnedWeaponIds: [s.src], exclusiveConsumedOwnedWeaponIds: [], exclusiveOwnedWeaponIds: [s.src] },
        C4: { satisfied: true, issues: [] }, C5: d2cContextParity(s.res, reservationDigest, c.registeredReservationDigest, c.phaseBUnits.map(u => ({ unitId: u.unitId, reservation: u.recordReservation }))) }, issues: [] }
    contextRows.push({ unitId: `CTX-${c.k}`, k: c.k, contextId: c.contextId, status: 'context_ready', notExecutedReason: null, process: PROC('00'), recordFile: { file: `CTX-${c.k}.context.json`, bytes: 1, sha256: `ctx${c.k}` } })
    contextRecords.set(`CTX-${c.k}`, JSON.parse(JSON.stringify({ ...CTXV, result })))
  }

  // DSC (rung-major): L0 k1 k2 k3, L1 k2.
  const discoveryRows: D2CDiscoveryRow[] = [], discoveryRecords = new Map<string, Record<string, unknown> | null>(), poolFiles = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  const gIds: Record<string, string> = {}
  const unit = (k: number, rung: 'L0' | 'L1', status: string, start: number, deliveries: { key: string; n: number; action: string; d2b?: number }[], search: Record<string, unknown>) => {
    const c = contexts.find(x => x.k === k)!
    const unitId = `DSC-${k}-${rung}`
    const si = `si-${k}-${rung}`
    const reservationDigest = hashStableValue(support[c.supportBuildListEntryId]!.res)
    let index = start
    const pooled = deliveries.filter(d => d.action === 'pooled').map(d => {
      index += 1
      const file = `${c.contextId}-c${index}.generated-entry.json`
      // D-3: the same key in two contexts of one Target materializes the same generated Entry ID, but two different G store bodies.
      const g = gIds[d.key] ?? `entry.d2c.g${d.n}`
      gIds[d.key] = g
      const fileSha = fakeSha(file)
      poolFiles.set(file, { bytes: 1, sha256: fileSha, body: { id: g, targetWeaponId: c.targetWeaponId, candidateSnapshot: { ...variant(d.n), searchRunId: si } } })
      return { indexInContext: index, indexInUnit: deliveries.indexOf(d), candidateStableKey: d.key, keySha256: syncSha(d.key), cost: 5, routeKind: 'existing_gogma_mixed', routeOperationCount: 2,
        r0: { respects: true, blockedHits: {}, exclusiveHit: [] }, searchIdentity: si, reservationDigest, generatedBuildListEntryId: g, reusedExisting: false,
        replacement: { status: 'ready', replacedBuildListEntryId: c.currentBuildListEntryId }, generatedEntry: null, generatedEntryFile: { file, bytes: 1, sha256: fileSha } }
    })
    discoveryRows.push({ unitId, k, contextId: c.contextId, rung, status, notExecutedReason: null, process: PROC('01'), recordFile: { file: `${unitId}.record.json`, bytes: 1, sha256: 'r' } })
    discoveryRecords.set(unitId, { ...CTXV, result: { status, unitId, contextId: c.contextId, rung, poolSizeAtStart: start, searchIdentity: si,
      deliveries: deliveries.map((d, i) => ({ indexInUnit: i, candidateStableKey: d.key, keySha256: syncSha(d.key), cost: 5, action: d.action, r0: { respects: true }, d2bK0Ordinal: d.d2b ?? null })), pooled,
      observedContext: { reservationDigest, originDigest: 'o', excludedRouteKeys: [oKey(c.targetIndex)], currentBuildListEntryId: c.currentBuildListEntryId },
      search: { deliveredCandidates: deliveries.length, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: false, skippedExcludedRouteKeys: 0, ...search }, timing: { searchOnlyMs: 1, materializeMs: 0 } } })
  }
  unit(1, 'L0', 'discovery_cap_reached', 0, [{ key: KA!, n: 1, action: 'pooled' }, { key: KB!, n: 2, action: 'pooled' }], { stoppedByConsumer: true })
  unit(2, 'L0', 'stopped_by_search_extent_bound', 0, [], { stoppedByExtent: true })
  unit(3, 'L0', 'discovery_exhausted', 0, [{ key: KE!, n: 5, action: 'same_key_as_d2b_k0_pool', d2b: 2 }, { key: KC!, n: 3, action: 'pooled' }], { exhausted: true })
  unit(2, 'L1', 'discovery_cap_reached', 0, [{ key: KC!, n: 3, action: 'pooled' }, { key: KD!, n: 4, action: 'pooled' }], { stoppedByConsumer: true })
  const pf = (contextK: number, i: number) => { const c = contexts.find(x => x.k === contextK)!; return poolFiles.get(`${c.contextId}-c${i}.generated-entry.json`)!.sha256 }
  // Candidates: t00 c1 (k1 #1), c2 (k1 #2); t03 c1 (k2 #1 KC), c2 (k2 #2 KD), c3 (k3 #1 KC, the same Entry ID as t03 c1).
  const cand: Record<string, { label: string; t: number; g: string; sha: string; sup: string; ctx: string; ordinal: number }> = {
    't00c1': { label: 't00', t: 0, g: gIds[KA!]!, sha: pf(1, 1), sup: SUP1, ctx: contexts[0]!.contextId, ordinal: 1 },
    't00c2': { label: 't00', t: 0, g: gIds[KB!]!, sha: pf(1, 2), sup: SUP1, ctx: contexts[0]!.contextId, ordinal: 2 },
    't03c1': { label: 't03', t: 3, g: gIds[KC!]!, sha: pf(2, 1), sup: SUP1, ctx: contexts[1]!.contextId, ordinal: 1 },
    't03c2': { label: 't03', t: 3, g: gIds[KD!]!, sha: pf(2, 2), sup: SUP1, ctx: contexts[1]!.contextId, ordinal: 2 },
    't03c3': { label: 't03', t: 3, g: gIds[KC!]!, sha: pf(3, 1), sup: SUP2, ctx: contexts[2]!.contextId, ordinal: 3 },
  }
  const i0Ref = { label: 't01', t: 1, g: G_I0, sha: GSHA_I0, sup: null as string | null }

  // Evaluations.
  const evaluationRows: D2CEvaluationRow[] = [], evaluationRecords = new Map<string, Record<string, unknown> | null>()
  const others = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'same_gogma_counter', participants: [`x${i}a`, `x${i}b`] }))
  const factsOf = (o: { selected: string[]; completed: number; conflicts: number; support: string[]; summary?: unknown; termination?: string; verdict?: boolean }): D2EvaluationFacts & { supportBodySha256Observed: Record<string, string> } => {
    const static_ = Object.fromEntries(o.support.map(id => [id, { S4: true, S5: { digestExpected: hashStableValue(support[id]!.res), digestObserved: hashStableValue(support[id]!.res), digestMatched: true,
      bodyExpected: structuredClone(support[id]!.res), bodyObserved: structuredClone(support[id]!.res), bodyMatched: true, satisfied: true } }]))
    const f = { preflight: { status: o.summary ? 'not_run' : 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
      plan: { present: true, termination: { status: o.termination ?? 'exhausted', completedTargetCount: o.completed, totalTargetCount: 43, reachedLimits: [] }, steps: 10 + o.completed, selectedBuildListEntryIds: [...o.selected].sort(), warningKinds: [] },
      conflicts: others(o.conflicts).map((c, i) => ({ id: `c${i}`, kind: c.kind, participants: c.participants, selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: null, resourceIdentityMatched: false })),
      routeCommitment: [], supportChecks: Object.fromEntries(o.support.map(id => [id, { S1: true, S2: true, S3: true, S4: true, S5: true }])),
      trialRunSummary: null, trialVerdict: o.verdict === undefined ? null : { status: 'found_R' as const, generatedSelected: true }, baselineSummary: (o.summary ?? null) as never, steps: [], resultDigest: '',
      rejectedBuildListEntries: [], resourceConflictRejections: 0, selectedTargetWeaponIds: [], supportStaticChecks: static_,
      supportBodySha256Observed: Object.fromEntries(o.support.map(id => [id, syncSha(stableStringify(support[id]!.body))])) }
    f.resultDigest = d1ResultDigest(f)
    return f
  }
  const evalRow = (id: string, stage: D2CEvaluationRow['stage'], label: string | null, ordinal: number | null, contextId: string | null, refs: { label: string; t: number; g: string; sha: string; sup: string | null }[], facts: ReturnType<typeof factsOf>) => {
    const reps = [...refs].sort((a, b) => a.t - b.t)
    const sup = [...new Set(reps.flatMap(r => r.sup ? [r.sup] : []))].sort()
    evaluationRows.push({ evaluationId: id, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', label, poolOrdinal: ordinal, contextId,
      replacementLabels: reps.map(r => r.label), replacementTargets: reps.map(r => T[r.t]!), generatedEntryIds: reps.map(r => r.g), generatedEntrySha256s: reps.map(r => r.sha), requiresSupport: sup,
      inputDigest: d1InputDigest(reps.map(r => T[r.t]!), reps.map(r => r.g), reps.map(r => r.sha), EXPORT), status: 'evaluated', notExecutedReason: null, process: PROC('02'),
      recordFile: { file: `${id}.record.json`, bytes: 1, sha256: 'r' }, runner: null })
    evaluationRecords.set(id, { ...CTXV, result: { status: 'evaluated', ...facts } })
    return facts
  }
  const sel = (...ids: string[]) => [...ids, ...O, SUP1, SUP2]
  const b0 = evalRow('B0', 'B0', null, null, null, [], factsOf({ selected: sel(), completed: 20, conflicts: 21, support: [], summary: SUMMARY }))
  const i0 = evalRow('I0', 'I0', null, null, null, [i0Ref], factsOf({ selected: sel(G_I0), completed: 22, conflicts: 20, support: [] }))
  for (const key of ['t00c1', 't00c2', 't03c1', 't03c2', 't03c3']) {
    const c = cand[key]!
    evalRow(`ADM-${c.label}-c${c.ordinal}`, 'ADM', c.label, c.ordinal, c.ctx, [c], factsOf({ selected: sel(c.g), completed: 21, conflicts: 21, support: [c.sup], verdict: true }))
  }
  evalRow('CMP-t00-c1', 'CMP', 't00', 1, cand.t00c1!.ctx, [i0Ref, cand.t00c1!], factsOf({ selected: sel(G_I0, cand.t00c1!.g), completed: 23, conflicts: 19, support: [SUP1] }))
  evalRow('CMP-t00-c2', 'CMP', 't00', 2, cand.t00c2!.ctx, [i0Ref, cand.t00c2!], factsOf({ selected: sel(G_I0, cand.t00c2!.g), completed: 22, conflicts: 20, support: [SUP1] }))
  evalRow('CMP-t03-c1', 'CMP', 't03', 1, cand.t03c1!.ctx, [i0Ref, cand.t00c1!, cand.t03c1!], factsOf({ selected: sel(G_I0, cand.t00c1!.g, cand.t03c1!.g), completed: 24, conflicts: 18, support: [SUP1] }))
  evalRow('CMP-t03-c2', 'CMP', 't03', 2, cand.t03c2!.ctx, [i0Ref, cand.t00c1!, cand.t03c2!], factsOf({ selected: [G_I0, cand.t00c1!.g, cand.t03c2!.g, ...O], completed: 24, conflicts: 18, support: [SUP1] }))
  evalRow('CMP-t03-c3', 'CMP', 't03', 3, cand.t03c3!.ctx, [i0Ref, cand.t00c1!, cand.t03c3!], factsOf({ selected: sel(G_I0, cand.t00c1!.g, cand.t03c3!.g), completed: 22, conflicts: 19, support: [SUP1, SUP2] }))
  validated.d2 = { b0: { evaluationId: 'B0', inputDigest: d1InputDigest([], [], [], EXPORT), resultDigest: b0.resultDigest },
    i0: { evaluationId: 'CMP-t09-c1', inputDigest: d1InputDigest([T[1]!], [G_I0], [GSHA_I0], EXPORT), resultDigest: i0.resultDigest, completed: 22, totalTargetCount: 43, conflicts: 20, steps: 32, termination: 'exhausted' },
    byInputDigest: {} }
  validated.d2.byInputDigest[validated.d2.b0.inputDigest] = [{ evaluationId: 'B0', status: 'evaluated', resultDigest: b0.resultDigest }]
  validated.d2.byInputDigest[validated.d2.i0.inputDigest] = [{ evaluationId: 'CMP-t09-c1', status: 'evaluated', resultDigest: i0.resultDigest }]
  return { validated, exportEntries, contextRows, contextRecords, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords, res: { [SUP1]: RES1, [SUP2]: RES2 } }
}

const analyze = (s: Synthetic, over: Partial<D2CAnalysisInput> = {}) => analyzeD2CRun({ validated: s.validated, exportSha256: EXPORT, exportBuildListEntries: s.exportEntries, recomputedOriginDigest: 'o',
  contextRows: s.contextRows, contextRecords: s.contextRecords, discoveryRows: s.discoveryRows, discoveryRecords: s.discoveryRecords, poolFiles: s.poolFiles, evaluationRows: s.evaluationRows,
  evaluationRecords: s.evaluationRecords, compositionRows: null, interrupted: false, discoveryEnvelopeReached: false, runEnvelopeReached: false, abortReason: null, provenanceIssues: [], evidenceIssues: [],
  rawConsistencyIssues: [], childProcessCount: null, sha256OfText: syncSha, ...over })
const states = (r: ReturnType<typeof analyze>) => Object.fromEntries(r.parityChecks.map(c => [c.checkId, c.state]))
const categories = (r: ReturnType<typeof analyze>) => r.invalidReasons.map(x => x.category)
const resultOf = (s: Synthetic, id: string) => s.evaluationRecords.get(id)!.result as D2EvaluationFacts & { supportBodySha256Observed: Record<string, string> }
const reDigest = (s: Synthetic, id: string) => { const f = resultOf(s, id); f.resultDigest = d1ResultDigest(f) }
const unmeasure = (s: Synthetic, id: string, outcome: string) => {
  const row = s.evaluationRows.find(r => r.evaluationId === id)!
  Object.assign(row, { status: outcome, process: { outcome, wallMs: 1 }, recordFile: null })
  s.evaluationRecords.delete(id)
}

describe('D2-C run analysis (§4 - §11)', () => {
  it('replays CTX, the rung-major discovery, D-3 / D-4, ADM and the single-pass CMP from the records and decides independently', () => {
    const r = analyze(synthetic())
    expect(r.invalidReasons).toEqual([])
    expect(r.contexts.map(c => [c.contextId, c.status, c.discoveryStop])).toEqual([[d2cContextId('t00', SUP1), 'context_ready', 'discovery_cap_reached'],
      [d2cContextId('t03', SUP1), 'context_ready', 'discovery_cap_reached'], [d2cContextId('t03', SUP2), 'context_ready', 'discovery_exhausted']])
    const t03 = r.discovery.targets.find(t => t.label === 't03')!
    expect(t03.pool.map(p => [p.ordinal, p.contextId, p.indexInContext])).toEqual([[1, d2cContextId('t03', SUP1), 1], [2, d2cContextId('t03', SUP1), 2], [3, d2cContextId('t03', SUP2), 1]])
    // D-3: the same key (and Entry ID) in two contexts stays two Candidates with their own support.
    expect(t03.pool[0]!.crossContextSameKey).toEqual([{ contextId: d2cContextId('t03', SUP2), k: 3, indexInContext: 1 }])
    expect(t03.pool[0]!.generatedBuildListEntryId).toBe(t03.pool[2]!.generatedBuildListEntryId)
    expect([t03.pool[0]!.requiresSupport, t03.pool[2]!.requiresSupport]).toEqual([[SUP1], [SUP2]])
    expect(r.discovery.units.find(u => u.unitId === 'DSC-3-L0')!.deliveries).toMatchObject([{ action: 'same_key_as_d2b_k0_pool', d2bK0Ordinal: 2 }, { action: 'pooled' }])
    expect(r.composition.main.steps.map(s => [s.label, s.stepOutcome, s.chosen])).toEqual([['t00', 'accepted', 'CMP-t00-c1'], ['t03', 'accepted', 'CMP-t03-c1']])
    expect(r.composition.main.steps[1]!.r5OnlyEligible).toEqual(['CMP-t03-c3'])
    expect(r.evaluations.find(e => e.evaluationId === 'CMP-t03-c2')!.r5).toMatchObject({ satisfied: false, failureReasons: ['support_not_selected'] })
    expect((r.evaluations.find(e => e.evaluationId === 'CMP-t03-c2')!.supportChecksByEntry as Record<string, { supportExpiryCause: string }>)[SUP1]!.supportExpiryCause).toBe('support_not_selected')
    expect(r.composition.main.finalMetrics).toEqual({ completed: 24, conflicts: 18, steps: 34 })
    expect(r.decision).toMatchObject({ case: 'D2C_EXCEEDS_D2B_MAIN', k1Accepted: [{ label: 't00', ordinal: 1 }, { label: 't03', ordinal: 1 }], vsD2bMain: { completedDelta: 2, conflictDelta: -2, better: true } })
    const s = states(r)
    expect([s['baseline:B0'], s['d2b_incumbent:I0'], s[`phase_b_k1_context:${d2cContextId('t03', SUP1)}`], s['phase_b_k1_prefix:t03-r10-L0'], s['determinism_d2b:B0'], s['determinism_d2b:I0']])
      .toEqual(['matched', 'matched', 'matched', 'matched', 'matched', 'matched'])
    // R1 (ADM, baseline) is never R5: ADM R5 is not judged.
    const adm = r.evaluations.find(e => e.evaluationId === 'ADM-t03-c3')!
    expect(adm.r5).toMatchObject({ judged: false })
    expect((adm.r1r4 as { R1: boolean; R2: boolean }).R1).toBe(true)
    expect(r.aggregates.childProcesses).toEqual({ registeredMax: 58, started: 3 + 4 + 12 })
  })

  it('classifies the decision top to bottom and never reads R5 as R6', () => {
    const base = { invalidReasons: [], unmeasured: [], k1Accepted: [{ label: 't00', contextId: 'c', ordinal: 1, generatedBuildListEntryId: 'g' }], finalMetrics: { completed: 22, conflicts: 20, steps: 1 },
      finalR6: false, i0Metrics: { completed: 22, conflicts: 20, steps: 1465 }, boundLimitedEvaluations: [], contextsWithoutCandidateMeasured: [], contextsUnmeasured: [] }
    expect(classifyD2CDecision({ ...base, invalidReasons: [{ category: 'guardrail', detail: 'x' }] }).case).toBe('D2C_INVALID')
    expect(classifyD2CDecision({ ...base, unmeasured: ['DSC-5-L2'], finalR6: true })).toMatchObject({ case: 'D2C_INCOMPLETE', lowerBound: true, globalCompleteObservedUnderIncomplete: true })
    expect(classifyD2CDecision({ ...base, finalR6: true }).case).toBe('D2C_GLOBAL_COMPLETE_R')
    expect(classifyD2CDecision({ ...base, finalMetrics: { completed: 22, conflicts: 19, steps: 1 } }).case).toBe('D2C_EXCEEDS_D2B_MAIN')
    expect(classifyD2CDecision(base).case).toBe('D2C_K1_ACCEPTED_NOT_BETTER')
    expect(classifyD2CDecision({ ...base, k1Accepted: [] }).case).toBe('D2C_NO_K1_ACCEPTED')
    // Better = completed, then Conflict; steps never decide.
    expect(classifyD2CDecision({ ...base, finalMetrics: { completed: 22, conflicts: 20, steps: 1 }, i0Metrics: { completed: 22, conflicts: 20, steps: 9999 } }).case).toBe('D2C_K1_ACCEPTED_NOT_BETTER')
  })

  it('judges R6 only with 43 / 43, Conflict 0, no resource_conflict and R5 (D2C_GLOBAL_COMPLETE_R)', () => {
    const s = synthetic()
    const f = resultOf(s, 'CMP-t03-c1')
    f.plan.termination = { status: 'completed', completedTargetCount: 43, totalTargetCount: 43, reachedLimits: [] }
    f.conflicts = []
    reDigest(s, 'CMP-t03-c1')
    expect(analyze(s).decision.case).toBe('D2C_GLOBAL_COMPLETE_R')
    f.rejectedBuildListEntries = [{ buildListEntryId: 'x', reason: 'resource_conflict' }]
    f.resourceConflictRejections = 1
    const r = analyze(s)
    expect(r.decision.case).toBe('D2C_EXCEEDS_D2B_MAIN')
    expect(r.evaluations.find(e => e.evaluationId === 'CMP-t03-c1')!.r6).toMatchObject({ judged: true, satisfied: false, conditions: { noResourceConflictRejection: false } })
  })

  it('makes a CTX reservationBody saved as a string, a missing CTX record or a body / digest disagreement INVALID (evidence_integrity)', () => {
    const str = synthetic()
    const rec = str.contextRecords.get('CTX-2')!.result as Record<string, unknown>
    rec.reservationBody = stableStringify(rec.reservationBody)
    expect(categories(analyze(str))).toContain('evidence_integrity')
    const gone = synthetic()
    gone.contextRecords.set('CTX-1', null)
    expect(analyze(gone).decision.case).toBe('D2C_INVALID')
    const digest = synthetic()
    ;(digest.contextRecords.get('CTX-3')!.result as Record<string, unknown>).reservationDigest = 'fnv1a32:00000000'
    expect(categories(analyze(digest))).toContain('evidence_integrity')
  })

  it('re-checks C1 / C3 / C4 / C5 independently: a support inside E1, a wrong origin, a C5 body mismatch are INVALID', () => {
    const c1 = synthetic()
    ;(c1.exportEntries[4] as { targetWeaponId: string }).targetWeaponId = T[2]!
    expect(categories(analyze(c1))).toContain('guardrail')
    expect(categories(analyze(synthetic(), { recomputedOriginDigest: 'other' }))).toContain('guardrail')
    const c5 = synthetic()
    c5.validated.contexts[1]!.phaseBUnits[0]!.recordReservation = { ...c5.res[SUP1], exclusiveOwnedWeaponIds: [] }
    const r = analyze(c5)
    expect(states(r)[`phase_b_k1_context:${d2cContextId('t03', SUP1)}`]).toBe('mismatched')
    expect(categories(r)).toContain('phase_b_k1_parity')
  })

  it('makes a normally measured Phase B K1 prefix mismatch, an I0 mismatch, a determinism mismatch and a D-1 repeat INVALID', () => {
    const prefix = synthetic()
    prefix.validated.contexts[0]!.phaseBUnits = [{ unitId: 't00-r09-L0', rung: 'L0', contextRank: 9, taskReservationDigest: 'x', recordReservation: {} }]
    expect(states(analyze(prefix))['phase_b_k1_prefix:t00-r09-L0']).toBe('mismatched')
    const i0 = synthetic()
    i0.validated.d2!.i0.conflicts = 21
    expect(categories(analyze(i0))).toContain('d2b_parity')
    const det = synthetic()
    det.validated.d2!.byInputDigest[det.validated.d2!.i0.inputDigest] = [{ evaluationId: 'CMP-t09-c1', status: 'evaluated', resultDigest: 'fnv1a32:00000000' }]
    expect(states(analyze(det))['determinism_d2b:I0']).toBe('mismatched')
    const d1 = synthetic()
    const dsc = d1.discoveryRecords.get('DSC-1-L0')!.result as { deliveries: { candidateStableKey: string }[] }
    dsc.deliveries[1]!.candidateStableKey = dsc.deliveries[0]!.candidateStableKey
    expect(categories(analyze(d1))).toContain('guardrail')
  })

  it('treats S4 / S5 failures as INVALID and S1 .. S3 expiry as support_expired_R (R5 false, measured)', () => {
    const s5 = synthetic()
    resultOf(s5, 'CMP-t00-c1').supportStaticChecks[SUP1]!.S5.bodyExpected = { other: true }
    expect(categories(analyze(s5))).toContain('guardrail')
    const s4 = synthetic()
    resultOf(s4, 'ADM-t00-c1').supportBodySha256Observed[SUP1] = '0'.repeat(64)
    expect(categories(analyze(s4))).toContain('guardrail')
    const expired = synthetic()
    resultOf(expired, 'CMP-t03-c3').supportChecks[SUP2]!.S3 = false
    reDigest(expired, 'CMP-t03-c3')
    const r = analyze(expired)
    expect(r.invalidReasons).toEqual([])
    const e = r.evaluations.find(x => x.evaluationId === 'CMP-t03-c3')!
    expect(e.r5).toMatchObject({ satisfied: false, failureReasons: ['support_expired_R'] })
    expect((e.supportChecksByEntry as Record<string, { supportExpiryCause: string }>)[SUP2]!.supportExpiryCause).toBe('support_entry_invalid')
    expect(r.composition.main.steps[1]!.r5OnlyEligible).toEqual([])
    expect(r.aggregates.supportOutcomes.expiredByCause).toEqual({ support_entry_invalid: 1 })
  })

  it('reads timeout / OOM / not_executed as unmeasured (INCOMPLETE, a lower bound), never as non-existence or non-coexistence', () => {
    const s = synthetic()
    unmeasure(s, 'CMP-t03-c2', 'timeout')
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2C_INCOMPLETE', lowerBound: true, exceedsD2bObservedUnderIncomplete: true })
    expect(r.composition.main.steps[1]!.stepOutcome).toBe('step_unmeasured')
    // An OOM DSC of one t03 context: that Target's step is not evaluated (dependency_unmeasured).
    const oom = synthetic()
    Object.assign(oom.discoveryRows[2]!, { status: 'out_of_memory', process: { outcome: 'out_of_memory', wallMs: 1 }, recordFile: null })
    oom.discoveryRecords.delete('DSC-3-L0')
    oom.evaluationRows = oom.evaluationRows.filter(e => !['ADM-t03-c3', 'CMP-t03-c1', 'CMP-t03-c2', 'CMP-t03-c3'].includes(e.evaluationId))
    const o = analyze(oom)
    expect(o.invalidReasons).toEqual([])
    expect(o.decision.case).toBe('D2C_INCOMPLETE')
    expect(o.composition.main.steps[1]).toMatchObject({ stepOutcome: 'step_unmeasured', stepNotEvaluatedReason: 'dependency_unmeasured' })
    expect(o.decision.contextsUnmeasured).toEqual([d2cContextId('t03', SUP2)])
  })

  it('makes a timed-out CTX skip its discovery (dependency_unmeasured) with not_checked parity, and I0 unmeasured block every CMP (i0_unmeasured)', () => {
    const s = synthetic()
    Object.assign(s.contextRows[1]!, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1 }, recordFile: null })
    s.contextRecords.delete('CTX-2')
    s.discoveryRows = s.discoveryRows.filter(r => r.k !== 2)
    s.discoveryRows.splice(1, 0, { unitId: 'DSC-2-L0', k: 2, contextId: d2cContextId('t03', SUP1), rung: 'L0', status: 'not_executed', notExecutedReason: 'dependency_unmeasured', process: null, recordFile: null })
    s.discoveryRows.push({ unitId: 'DSC-2-L1', k: 2, contextId: d2cContextId('t03', SUP1), rung: 'L1', status: 'not_executed', notExecutedReason: 'dependency_unmeasured', process: null, recordFile: null },
      { unitId: 'DSC-2-L2', k: 2, contextId: d2cContextId('t03', SUP1), rung: 'L2', status: 'not_executed', notExecutedReason: 'dependency_unmeasured', process: null, recordFile: null })
    // t03 keeps only the k3 Candidate (ordinal 1 now); its ADM runs, its CMP step is not evaluated (dependency_unmeasured).
    s.evaluationRows = s.evaluationRows.filter(e => !['ADM-t03-c1', 'ADM-t03-c2', 'CMP-t03-c1', 'CMP-t03-c2', 'CMP-t03-c3'].includes(e.evaluationId))
    Object.assign(s.evaluationRows.find(e => e.evaluationId === 'ADM-t03-c3')!, { evaluationId: 'ADM-t03-c1', poolOrdinal: 1 })
    s.evaluationRecords.set('ADM-t03-c1', s.evaluationRecords.get('ADM-t03-c3')!)
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(r.decision.case).toBe('D2C_INCOMPLETE')
    const st = states(r)
    expect([st[`phase_b_k1_context:${d2cContextId('t03', SUP1)}`], st['phase_b_k1_prefix:t03-r10-L0']]).toEqual(['not_checked', 'not_checked'])
    const i0 = synthetic()
    unmeasure(i0, 'I0', 'out_of_memory')
    for (const row of i0.evaluationRows.filter(e => e.stage === 'CMP')) {
      Object.assign(row, { status: 'not_executed', notExecutedReason: 'i0_unmeasured', process: null, recordFile: null, inputDigest: null })
      i0.evaluationRecords.delete(row.evaluationId)
      // No t00 Candidate is accepted when every CMP is blocked, so the t03 proposals hold the I0 set plus the t03 Candidate only.
      if (row.label === 't03') {
        const keep = row.replacementLabels.map((l, i) => l === 't00' ? -1 : i).filter(i => i >= 0)
        Object.assign(row, { replacementLabels: keep.map(i => row.replacementLabels[i]), replacementTargets: keep.map(i => row.replacementTargets[i]), generatedEntryIds: keep.map(i => row.generatedEntryIds[i]),
          generatedEntrySha256s: keep.map(i => row.generatedEntrySha256s[i]), requiresSupport: row.evaluationId === 'CMP-t03-c3' ? [SUP2] : [SUP1] })
      }
    }
    const ri = analyze(i0)
    expect(ri.invalidReasons).toEqual([])
    expect(ri.decision.case).toBe('D2C_INCOMPLETE')
    expect(states(ri)['d2b_incumbent:I0']).toBe('not_checked')
  })

  it('accepts the discovery / run envelope not_executed rows only when the envelope was reached', () => {
    const s = synthetic()
    Object.assign(s.discoveryRows[3]!, { status: 'not_executed', notExecutedReason: 'discovery_envelope_reached', process: null, recordFile: null })
    s.discoveryRecords.delete('DSC-2-L1')
    s.evaluationRows = s.evaluationRows.filter(e => !['ADM-t03-c1', 'ADM-t03-c2', 'CMP-t03-c1', 'CMP-t03-c2', 'CMP-t03-c3'].includes(e.evaluationId))
    const t03c3 = s.evaluationRows.find(e => e.evaluationId === 'ADM-t03-c3')!
    t03c3.evaluationId = 'ADM-t03-c1'; t03c3.poolOrdinal = 1
    s.evaluationRecords.set('ADM-t03-c1', s.evaluationRecords.get('ADM-t03-c3')!)
    expect(analyze(s, { discoveryEnvelopeReached: true }).decision.case).toBe('D2C_INCOMPLETE')
    expect(categories(analyze(s, { discoveryEnvelopeReached: false }))).toContain('raw_result_mismatch')
    const run = synthetic()
    Object.assign(run.evaluationRows.find(e => e.evaluationId === 'CMP-t03-c3')!, { status: 'not_executed', notExecutedReason: 'run_envelope_reached', process: null, recordFile: null, inputDigest: null })
    expect(analyze(run, { runEnvelopeReached: true }).decision.case).toBe('D2C_INCOMPLETE')
    expect(categories(analyze(run))).toContain('raw_result_mismatch')
  })

  it('makes a missing record / G store of a completed child, an out-of-order row and an aborted run without a reason INVALID', () => {
    const s = synthetic()
    s.evaluationRecords.delete('CMP-t00-c1')
    expect(categories(analyze(s))).toContain('evidence_integrity')
    const gone = synthetic()
    gone.poolFiles.set(`${d2cContextId('t00', SUP1)}-c2.generated-entry.json`, null)
    expect(categories(analyze(gone))).toContain('evidence_integrity')
    const order = synthetic()
    const [a, b] = [order.discoveryRows[1]!, order.discoveryRows[2]!]
    order.discoveryRows[1] = b; order.discoveryRows[2] = a
    expect(categories(analyze(order))).toContain('guardrail')
    expect(categories(analyze(synthetic(), { abortReason: 'x' }))).toContain('raw_result_mismatch')
    // The runner's own R5 / R1 are never adopted: a disagreement with the analyzer is a raw_result_mismatch.
    const self = synthetic()
    self.evaluationRows.find(e => e.evaluationId === 'CMP-t03-c1')!.runner = { r5: { judged: true, satisfied: false } }
    self.evaluationRows.find(e => e.evaluationId === 'ADM-t00-c1')!.runner = { r1: false }
    expect(analyze(self).invalidReasons.filter(x => x.category === 'raw_result_mismatch').map(x => x.detail)).toEqual(['ADM-t00-c1: the runner R1 differs from the analyzer R1', 'CMP-t03-c1: the runner R5 differs from the analyzer R5'])
    expect(analyze(synthetic(), { evidenceIssues: ['x: the record file is not the one the journal recorded'] }).decision.case).toBe('D2C_INVALID')
  })
})

// ---------------------------------------------------------------- oracle isolation, sources and the RESULT schema (§10.2 / §10.3 / §12)

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

describe('D2-C oracle isolation, sources and Production (§10.2 / §10.3 / G29 - G36)', () => {
  it('reaches no oracle, Phase B analysis or population-authority module from the runner, child or analyzer modules', () => {
    for (const entry of ['./plannerGlobalD2C.ts', './plannerGlobalD2CAnalysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalD2.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound/.test(f))).toEqual([])
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD2.ts', '/src/benchmarks/plannerGlobalD2C.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD2C.ts', '/src/benchmarks/plannerGlobalD2CAnalysis.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/domain/models/hashing.ts', '/src/domain/planner/replacement/plannerSearchOrigin.ts'])
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|_1657_/)
    expect(codeOnly(runnerSource)).not.toMatch(/d2c-smoke1|PHASE2C25D2C/)
  })

  it('hard-codes no Target, Entry, reservation digest or stable key in the D2-C code (the context table comes from the D2 RESULT)', () => {
    const values = TABLE.flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.supportBuildListEntryId, r.contextId, r.registeredReservationDigest ?? 'none-registered'])
    expect(values).toHaveLength(35)
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|fnv1a32[-:][0-9a-f]{8}|build-list\.fnv1a32/)
      for (const id of values) expect(source).not.toContain(id.replace(/^build-list\.(constrained\.)?/, '').slice(0, 16))
    }
  })

  it('searches K1 contexts only and writes no resolution, lineage or selected Entry anywhere (G1 / G29 / G30)', () => {
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, \[task\.supportBuildListEntryId\]\)/)
    expect(codeOnly(mainSource)).not.toMatch(/phase2c27bResolveSupportContext\([^)]*, \[\]\)/)
    expect(codeOnly(mainSource)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|runPlannerAlternativeKernel|mergePlannerConflictScenarioResolution|selectedBuildListEntryId:/)
    // found_R is never a discovery stop; there is no trial during discovery.
    expect(codeOnly(mainSource)).not.toMatch(/judgePlannerAlternativeTrial|found_R'\) return 'stop'/)
  })

  it('is never imported by Production, changes no D2 / D1 / Phase B module, and counts Production source changes by the registered rule', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2C/.test(source)).map(([path]) => path)).toEqual([])
    // Only the D2-C files themselves and the registered successors D2-D (D2-D-A §13), D2-E (D2-E-A §14) and D2-F (D2-F-A §15: all
    // import the unchanged D2-C module) may reference the D2-C modules, by exact path. Phase 2-C2.5-D2-D / D2-E / D2-F
    // (`plannerGlobalPhase2C25D2D*` / `plannerGlobalPhase2C25D2E*` / `plannerGlobalPhase2C25D2F*`) are other Research items and are
    // never allowed, although their paths hold `D2D` / `D2E` / `D2F`.
    const allowed = ['./plannerGlobalD2C.ts', './plannerGlobalD2CAnalysis.ts', './plannerGlobalD2C.test.ts', './plannerGlobalD2D.ts', './plannerGlobalD2DAnalysis.ts', './plannerGlobalD2D.test.ts',
      './plannerGlobalD2E.ts', './plannerGlobalD2EAnalysis.ts', './plannerGlobalD2E.test.ts', './plannerGlobalD2F.ts', './plannerGlobalD2FAnalysis.ts']
    const illegalD2CReferences = (sources: Record<string, string>) => Object.entries(sources).filter(([path, source]) => !allowed.includes(path) && /plannerGlobalD2C/.test(source)).map(([path]) => path)
    expect(illegalD2CReferences(benchmarkSources)).toEqual([])
    expect(allowed.filter(path => /Phase2C25D2D|Phase2C25D2E|Phase2C25D2F/.test(path))).toEqual([])
    // Every allowed path is a real file (the glob never lists the importing test file itself).
    for (const path of allowed.filter(x => x !== './plannerGlobalD2C.test.ts')) expect(benchmarkSources[path], path).toBeDefined()
    const phase2c25d2d = Object.keys(benchmarkSources).filter(path => /^\.\/plannerGlobalPhase2C25D2D/.test(path))
    expect(phase2c25d2d.length).toBeGreaterThan(0)
    const phase2c25d2e = Object.keys(benchmarkSources).filter(path => /^\.\/plannerGlobalPhase2C25D2E/.test(path))
    expect(phase2c25d2e.length).toBeGreaterThan(0)
    for (const path of [...phase2c25d2d, ...phase2c25d2e]) {
      expect(illegalD2CReferences({ ...benchmarkSources, [path]: `${benchmarkSources[path]}\nimport { runD2CEvaluation } from './plannerGlobalD2C'\n` })).toEqual([path])
    }
    expect(d2cProductionChangedFiles(['src/benchmarks/plannerGlobalD2C.ts', 'scripts/run-planner-global-d2c.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d2cProductionChangedFiles(['src/domain/planner/x.ts'])).toEqual(['src/domain/planner/x.ts'])
  })

  it('writes every §12 required RESULT field in the analyzer', () => {
    for (const field of ['phase:', 'analyzedAt:', 'sources:', 'specDocument:', 'generatedEntriesUsedByI0:', 'phaseB:', 'targetsManifest:', 'tasks:', 'records:', 'phase2c2Result:', 'export:', 'documents:',
      'd2c:', 'contextRecords', 'provenance:', 'formal,', 'measuredHead,', 'analysisHead,', 'measuredHeadIsAncestor,', 'runStatus,', 'benchmarkCodeSha256,', 'registeredPolicySha256,',
      'calculationCodeChangedSinceMeasuredHead,', 'productionChangedFiles:', 'startAttestation:', 'd2MeasuredHead:', 'phaseBMeasuredHead:', 'D2C_PROVENANCE_FLAGS', 'd2ResultFieldsRead:',
      'phaseBResultFieldsRead:', 'phaseBTaskFieldsRead:', 'phaseBRecordFieldsRead:', 'd1SpecFieldsRead:', 'd2ResultModified:', 'phaseBResultModified:', 'environment:', 'conditions:', 'scopeTargets:',
      'contexts:', 'derivationRule:', 'supportCapPerTarget:', 'k1PoolCap:', 'ladder:', 'dedupRules:', 'discoveryRule:', 'admissionRule:', 'incumbent:', 'compositionRule:', 'r5Definition:', 'gate:',
      'selectionOrder:', 'r6Definition:', 'contextChecks:', 'supportChecks:', 'supportExpiryCauses:', 'budgets:', 'order:', 'executionEnvelope:', 'researchMaxPlanSteps:', 'evaluationFullRunCap:',
      'decisionRule:', 'comparisonBaselines:', 'notRun:', 'inputValidation:', 'derivedContexts:', 'discovery:', 'evaluations:', 'parityChecks:', 'composition:', 'comparison:', 'aggregates:', 'timing:',
      'contextWallMs:', 'discoveryEnvelopeReached:', 'memory:', 'invalidReasons:', 'decision:']) expect(analyzerSource).toContain(field)
    for (const flag of ['oracleReadByRunner', 'oracleReadByChild', 'oracleReadByAnalyzer', 'd2ResultModified', 'phaseBResultModified', 'd2EvidenceReusedAsResult', 'oracleGuidedTargetPopulation',
      'inheritsOracleInformedExtentLadder', 'inheritsOracleInformedExecutionEnvelope', 'supportDerivedFromD2ProvisionalWinners', 'speculativeSupportWrittenAsResolution', 'k0SearchInD2C', 'k2SearchInD2C',
      'alternativeToAlternativeSupport', 'productionSemanticsChanged']) expect(mainSource).toContain(`${flag}:`)
    const r = analyze(synthetic())
    expect(Object.keys(r).sort()).toEqual(['aggregates', 'comparison', 'composition', 'contexts', 'decision', 'discovery', 'evaluations', 'invalidReasons', 'parityChecks', 'unmeasured'])
    expect(Object.keys(r.decision).sort()).toEqual(['boundLimitedEvaluations', 'case', 'contextsUnmeasured', 'contextsWithoutCandidateMeasured', 'exceedsD2bObservedUnderIncomplete',
      'globalCompleteObservedUnderIncomplete', 'k1Accepted', 'lowerBound', 'reasons', 'vsBaseline', 'vsD1Incumbent', 'vsD2bMain'])
    for (const c of r.contexts) for (const k of ['contextId', 'k', 'label', 'targetWeaponId', 'currentBuildListEntryId', 'supportBuildListEntryId', 'supportTargetWeaponId', 'observations', 'observedEvaluations',
      'orderInTarget', 'status', 'unmeasuredReason', 'notExecutedReason', 'process', 'record', 'supportBodySha256', 'reservationDigest', 'reservationBody', 'originDigest', 'excludedRouteKeySha256s', 'checks',
      'discoveryStop', 'discoveryIncompleteAfterUnmeasured']) expect(c).toHaveProperty(k)
    expect(typeof r.contexts[0]!.reservationBody).toBe('object')
    for (const u of r.discovery.units) for (const k of ['unitId', 'contextId', 'label', 'rung', 'extent', 'status', 'unmeasuredReason', 'notExecutedReason', 'process', 'searchIdentity', 'reservationDigest',
      'poolSizeAtStart', 'poolSizeAtEnd', 'deliveries', 'search', 'phaseBParity', 'searchOnlyMs', 'materializeMs', 'wallMs', 'peakHeapBytes', 'peakRssBytes']) expect(u).toHaveProperty(k)
    for (const e of r.evaluations) for (const k of ['stage', 'poolOrdinal', 'contextId', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'referenceDiff', 'gate', 'r5OnlyEligible',
      'eligible', 'r5', 'supportChecksByEntry', 'r6', 'r1r4', 'd2bParity', 'inputDigest', 'resultDigest', 'candidates', 'conflicts']) expect(e).toHaveProperty(k)
    expect(Object.keys(r.comparison.targets[0]!).sort()).toEqual(['acceptedContextId', 'acceptedOrdinal', 'contexts', 'label', 'mainOutcome', 'supportExpiredEvaluations', 'supportNotSelectedEvaluations',
      'targetsGainedWhenAccepted', 'targetsLostWhenAccepted', 'winnersObserved'])
    for (const k of ['contexts', 'discovery', 'evaluations', 'childProcesses', 'fullPlannerRunsStarted', 'runtimeUnsupportedRetries', 'r5', 'r6', 'boundLimitedEvaluations', 'supportOutcomes',
      'determinismCrossChecks', 'parity']) expect(r.aggregates).toHaveProperty(k)
  })
})

// ---------------------------------------------------------------- start attestation (§10.2)

const observation = () => ({ createdAt: '2026-10-11T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d2c.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D2C_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? 'e'.repeat(64) }])),
  observedI0Files: Object.fromEntries(D2C_I0_FILES.map(f => [f.file, { bytes: f.bytes, sha256: f.sha256 }])),
  observedPhaseBFiles: Object.fromEntries(D2C_PHASE_B_UNITS.flatMap(u => [[`${u.unitId}.task`, { bytes: u.taskBytes, sha256: u.taskSha256 }], [`${u.unitId}.record`, { bytes: u.recordBytes, sha256: u.recordSha256 }]])),
  exportFileName: D2C_REGISTERED_INPUTS.export.file, productionAudit: { baseMain: D2C_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 }, appliedExecutionEnvelope: { ...D2C_EXECUTION_ENVELOPE }, rngEngineVersion: 'production-rng:c5-e7',
  observedCalculationContext: { ...D2C_CALCULATION_CONTEXT }, smoke: null })
const expectation = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64), exportSha256: 'e'.repeat(64), firstChildStartedAt: '2026-10-11T00:00:01.000Z' }

describe('D2-C start attestation', () => {
  it('verifies a clean formal launch and fails on any drift', () => {
    const verify = (patch: object, exp = expectation) => verifyD2CStartAttestation(JSON.parse(JSON.stringify({ ...d2cStartAttestationBody(observation()), ...patch })), exp)
    expect(verify({})).toEqual({ verified: true, issues: [] })
    expect(verify({ productionAudit: { baseMain: D2C_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { contextKs: [1], maxChildren: null, budgetMs: null, maxRung: null, skipEvaluations: false } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ k1PoolCap: 3 }).issues).toContain('k1PoolCap differs from the registered condition')
    expect(verify({ appliedExecutionEnvelope: { ...D2C_EXECUTION_ENVELOPE, discoveryEnvelopeMs: 1 } }).verified).toBe(false)
    expect(verify({ rngEngineVersion: 'production-rng:c5-e8' }).verified).toBe(false)
    expect(verify({ observedCalculationContext: { ...D2C_CALCULATION_CONTEXT, appSchemaVersion: 18 } }).verified).toBe(false)
    expect(verify({ observedPhaseBFiles: {} }).verified).toBe(false)
    expect(verify({ observedI0Files: {} }).verified).toBe(false)
    expect(verify({}, { ...expectation, registeredPolicySha256: 'f'.repeat(64) }).issues).toContain('registeredPolicySha256 differs')
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-10T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
