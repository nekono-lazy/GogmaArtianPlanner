import { beforeEach, describe, expect, it, vi } from 'vitest'
import phaseBResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import d1ResultRaw from '../../docs/PLANNER_GLOBAL_D1_RESULT.json?raw'
import d1Document from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md?raw'
import d1bDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1B.md?raw'
import d2Document from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d2.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d2.mjs?raw'
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
import { hashStableValue } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId, TargetWeapon } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, d1ResultDigest, parseD1SpecTables, runD1Evaluation, type D1EvaluationTask } from './plannerGlobalD1'
import { phase2c27bResolveSupportContext, runPhase2C27BTrialLoop, PHASE2C27B_INITIAL_LADDER_STATE, PHASE2C27B_LADDER, PHASE2C27B_POPULATION_AUTHORITY } from './plannerGlobalPhase2C27B'
import mainSource from './plannerGlobalD2.ts?raw'
import analysisSource from './plannerGlobalD2Analysis.ts?raw'
import {
  compareD2Selection,
  d2CompositionStep,
  d2D1GeneratedParity,
  d2DiscoveryNext,
  d2DiscoveryUnitOutcome,
  d2DroppedTargetIndexes,
  d2GateSatisfied,
  d2NamesSha256,
  d2PhaseBPrefixParity,
  d2ProductionChangedFiles,
  d2R1R4,
  d2RegisteredConditions,
  d2RegisteredPolicySha256,
  d2StartAttestationBody,
  judgeD2R6,
  projectD2D1Result,
  projectD2PhaseBResult,
  runD2DiscoveryUnit,
  runD2Evaluation,
  validateD2Inputs,
  verifyD2StartAttestation,
  D2_BASE_MAIN,
  D2_BUDGETS,
  D2_CALCULATION_CONTEXT,
  D2_EXECUTION_ENVELOPE,
  D2_LADDER,
  D2_POOL_CAP,
  D2_REGISTERED_INPUTS,
  D2_SEED_FILES,
  type D2DiscoveryTask,
  type D2EvaluationFacts,
  type D2EvaluationTask,
  type D2InputEvidence,
  type D2ReplacementTask,
  type D2StepEvaluation,
  type D2ValidatedInputs,
} from './plannerGlobalD2'
import { analyzeD2Run, classifyD2Decision, classifyD2SeededDecision, type D2AnalysisInput, type D2DiscoveryRow, type D2EvaluationRow } from './plannerGlobalD2Analysis'

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const codeOnly = (source: string) => source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
const fakeSha = (seed: string) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i) % 16]).join('')
const syncSha = (text: string) => fakeSha(`sha:${text}`)

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

// ---------------------------------------------------------------- registered conditions (D2-A §2 - §8)

describe('D2 registered conditions', () => {
  it('registers the committed inputs by their SHA-256 and every value the D2-A document names', async () => {
    expect(await sha256(phaseBResultRaw)).toBe(D2_REGISTERED_INPUTS.phaseBResult.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D2_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(d1ResultRaw)).toBe(D2_REGISTERED_INPUTS.d1Result.sha256)
    expect(await sha256(d1Document.replace(/\r\n/g, '\n'))).toBe(D2_REGISTERED_INPUTS.d1SpecDocument.sha256)
    expect(await sha256(d1bDocument.replace(/\r\n/g, '\n'))).toBe(D2_REGISTERED_INPUTS.d1bDocument.sha256)
    for (const registered of Object.values(D2_REGISTERED_INPUTS)) if (registered.sha256 !== null) expect(d2NamesSha256(d2Document, registered.sha256)).toBe(true)
    for (const seed of D2_SEED_FILES) expect(d2NamesSha256(d2Document, seed.sha256)).toBe(true)
    // The Export digest is reached through the Phase B / D1 RESULT chain, never written in a Research source.
    expect(D2_REGISTERED_INPUTS.export.sha256).toBeNull()
    expect(D2_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
  })

  it('fixes POOL_CAP, the ladder, the budgets and the envelope as D2-A registers them', () => {
    expect(D2_POOL_CAP).toBe(3)
    expect(D2_LADDER.map(r => [r.id, r.extent])).toEqual(PHASE2C27B_LADDER.map(r => [r.id, r.extent]))
    expect(D2_LADDER.map(r => [r.extent.maxNormalAdvance, r.extent.maxGogmaAdvance, r.extent.maxSkillAdvance])).toEqual([[4, 235, 4], [8, 235, 256], [128, 235, 1500]])
    expect(D2_BUDGETS).toMatchObject({ discoveryUnitsMax: 33, uniqueCandidatesMax: 33, admissionEvaluationsMax: 33, compositionMainEvaluationsMax: 33, compositionSeededEvaluationsMax: 22,
      b0Evaluations: 1, evaluationRequestsMax: 89, evaluationFullRunCap: 8, researchMaxPlanSteps: 20_000, deliveriesPerUnitMax: 3 })
    expect(D2_EXECUTION_ENVELOPE).toEqual({ discoveryUnitBudgetMs: 3_600_000, evaluationBudgetMs: 1_800_000, runBudgetMs: 43_200_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none',
      memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D2_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(d2Document).toContain('POOL_CAP = 3')
    expect(d2Document).toMatch(/評価リクエスト合計 \| B0 1 \+ ADM ≤ 33 \+ CMP ≤ 33 \+ Z ≤ 22 = \*\*89以下\*\*/)
    expect(d2RegisteredPolicySha256(syncSha)).toBe(d2RegisteredPolicySha256(syncSha))
    expect(d2RegisteredConditions().selectionOrder).toEqual(['completed desc', 'result.conflicts.length asc', 'plan.steps.length asc', 'discovery ordinal asc'])
  })

  it('reads only the allowlisted Phase B / D1 RESULT fields', () => {
    const phaseB = projectD2PhaseBResult(JSON.parse(phaseBResultRaw))!
    expect(JSON.stringify(phaseB)).not.toMatch(/oracle|covering|exactRecovered/i)
    expect(phaseB.k0Units).toHaveLength(24)
    expect(Object.keys(phaseB.k0Units[0]!).sort()).toEqual(['contextRank', 'deliveries', 'result', 'rung', 'search', 'targetIndex', 'unitId'])
    const d1 = projectD2D1Result(JSON.parse(d1ResultRaw))!
    expect(d1.evaluations).toHaveLength(80)
    expect(Object.keys(d1.evaluations[0]!).sort()).toEqual(['conflictCount', 'evaluatedAgainst', 'evaluationId', 'generatedEntryIds', 'generatedEntrySha256s', 'inputDigest', 'r5Satisfied',
      'replacementTargets', 'resultDigest', 'stage', 'status', 'steps', 'termination'])
  })
})

// ---------------------------------------------------------------- V (§8.1)

/** The real committed inputs plus a manifest / seed bodies rebuilt from them (the `.local` files are not in CI). */
function realEvidence(): D2InputEvidence {
  const d1 = JSON.parse(d1ResultRaw)
  const phaseB = JSON.parse(phaseBResultRaw)
  const exportSha = phaseB.sources.export.sha256 as string
  const ids = parseD1SpecTables(d1Document).found.map(r => r.targetWeaponId)
  const aB = d1.evaluations.find((e: { evaluationId: string }) => e.evaluationId === 'A-b')
  const files = Object.fromEntries(Object.entries(D2_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? exportSha }])) as D2InputEvidence['files']
  return {
    files,
    manifest: { phase: 'manifest', population: 'E1', b2c2b1ResultSha256: PHASE2C27B_POPULATION_AUTHORITY.b2c2b1ResultSha256, b2c1ResultSha256: PHASE2C27B_POPULATION_AUTHORITY.b2c1ResultSha256,
      exportSha256: exportSha, oracleGuidedTargetPopulation: true, targetWeaponIds: ids },
    phaseBResult: phaseB, phase2c2Result: JSON.parse(phase2c2ResultRaw), d1Result: d1,
    seedFiles: Object.fromEntries(D2_SEED_FILES.map((s, i) => [s.unitId, { file: { bytes: s.bytes, sha256: s.sha256 }, json: { id: aB.generatedEntryIds[i], targetWeaponId: aB.replacementTargets[i] } }])),
    specMarkdown: d2Document.replace(/\r\n/g, '\n'), d1SpecMarkdown: d1Document.replace(/\r\n/g, '\n'),
  }
}

describe('D2 V: inputs fail closed (§8.1)', () => {
  it('passes the registered inputs and derives the 11 Targets, the K0 digest, the D1 references and the seed mechanically', () => {
    const v = validateD2Inputs(realEvidence())
    expect(v.issues).toEqual([])
    expect(v.targets.map(t => t.label)).toEqual(Array.from({ length: 11 }, (_, i) => `t${String(i).padStart(2, '0')}`))
    expect(v.targets.filter(t => t.d1Generated === null).map(t => t.label)).toEqual(['t09'])
    expect(v.targets.map(t => t.firstK0DeliveryRung)).toEqual(['L1', 'L1', 'L2', 'L2', 'L2', 'L0', 'L0', 'L1', 'L2', null, 'L1'])
    expect(Object.values(v.targets).reduce((n, t) => n + Object.keys(t.phaseBK0Units).length, 0)).toBe(24)
    expect(v.k0ReservationDigest).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(v.seed.map(s => [s.label, s.isK1Candidate, s.requiresSupport.length])).toEqual([['t01', false, 0], ['t07', false, 0], ['t08', false, 0], ['t09', true, 1]])
    expect(d2DroppedTargetIndexes(v.seed)).toEqual([0, 2, 3, 4, 5, 6, 10])
    expect(v.d1?.byInputDigest[v.d1.aB.inputDigest]?.map(x => x.evaluationId)).toEqual(['A-b', 'A-c-10'])
  })

  const failing = (mutate: (e: D2InputEvidence) => void) => {
    const e = realEvidence()
    mutate(e)
    const v = validateD2Inputs(e)
    expect(v.passed).toBe(false)
    expect(v.targets).toEqual([])
    return v.issues.join(';')
  }

  it('fails closed on a missing file, a digest or byte mismatch and a broken Export chain, never substituting a value', () => {
    expect(failing(e => { e.files.phaseBTargets = null })).toMatch(/phaseBTargets: .* is missing/)
    expect(failing(e => { e.files.d1Result = { bytes: 1_588_705, sha256: '0'.repeat(64) } })).toMatch(/d1Result: SHA-256/)
    expect(failing(e => { e.files.export = { bytes: 19_424_064, sha256: '1'.repeat(64) } })).toMatch(/export: SHA-256/)
    expect(failing(e => { (e.manifest as { exportSha256: string }).exportSha256 = '2'.repeat(64) })).toMatch(/the manifest Export is not the chained Export/)
    expect(failing(e => { e.seedFiles['t09-r10-L1'] = null })).toMatch(/t09-r10-L1: the D1 G store seed file is missing/)
    expect(failing(e => { (e.seedFiles['t07-r01-L1']!.json as { id: string }).id = 'other' })).toMatch(/t07-r01-L1: the seed body is not the D1 A-b G/)
  })

  it('fails closed when the Phase B K0 units, the D1 RESULT or the documents disagree', () => {
    expect(failing(e => { (e.phaseBResult as { decision: { case: string } }).decision.case = 'B2C27B_E1_PARTIAL' })).toMatch(/decision.case is not B2C27B_INCOMPLETE/)
    expect(failing(e => { ((e.phaseBResult as { units: { contextRank: number; deliveries: { keySha256: string }[] }[] }).units.find(u => u.contextRank === 1 && u.deliveries.length > 0)!.deliveries[0]!.keySha256 = 'f'.repeat(64)) }))
      .toMatch(/the first K0 delivery is not the D2-A §1.2 table/)
    expect(failing(e => { (e.d1Result as { decision: { case: string } }).decision.case = 'D1_INCOMPLETE' })).toMatch(/D1 RESULT decision.case/)
    expect(failing(e => { (e.d1Result as { aggregates: { aCFinalAccepted: number[] } }).aggregates.aCFinalAccepted = [1, 7] })).toMatch(/aCFinalAccepted/)
    expect(failing(e => { ((e.d1Result as { evaluations: { evaluationId: string; plan: { steps: number } }[] }).evaluations.find(x => x.evaluationId === 'B0')!.plan.steps = 1) })).toMatch(/D1 RESULT B0 is not the §9.1 comparison value/)
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| t05 | found_R', '| t05 | extent bound') })).toMatch(/t05-r01-L0: the Phase B result found_R is not the D2-A §1.2 table/)
    expect(failing(e => { e.d1SpecMarkdown = e.d1SpecMarkdown.replace(/\| t03 \| `[^`]+`/, '| t03 | `other-target`') })).toMatch(/t03: the D1-A §1.3 Target is not the manifest Target 3/)
  })
})

// ---------------------------------------------------------------- DSC (§2.3), on the D1 Fake RNG Engine fixture

const TARGET_A = 'target.d2.a', TARGET_B = 'target.d2.b'
const ENTRY_A = 'build-list.d2.a' as BuildListEntryId, ENTRY_B = 'build-list.d2.b' as BuildListEntryId
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source'
const SMALL = { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 }
const WIDE = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }

function fixture(): OrchestrationScenario {
  const skill = { seriesSkillId: SKILL_A, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const ownedWeapons = [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }),
    orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B })]
  const entries = [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] })]
  return orchestrationScenario({ targets: [a, b], ownedWeapons, entries })
}
const research = (built: OrchestrationScenario) => ({ ...built.input, options: { maxPlanSteps: 20_000 } })
const discoveryTask = (over: Partial<D2DiscoveryTask> = {}): D2DiscoveryTask => ({ unitId: 'DSC-t00-L0', targetIndex: 0, label: 't00', targetWeaponId: TARGET_B, rung: 'L0', extent: WIDE,
  currentBuildListEntryId: ENTRY_B, k0ReservationDigest: 'k0', poolKeysAtStart: [], poolCap: 3, researchMaxPlanSteps: 20_000, ...over })
async function discover(over: Partial<D2DiscoveryTask> = {}) {
  const built = fixture()
  const resolved = phase2c27bResolveSupportContext(research(built), built.dependencies, over.targetWeaponId ?? TARGET_B, [])
  if (resolved.status !== 'ready') throw new Error(resolved.issues.join('; '))
  return { built, unit: await runD2DiscoveryUnit(research(built), resolved.prepared, discoveryTask(over), built.dependencies) }
}

describe('D2 DSC: discovery (§2.3)', () => {
  it('pools up to POOL_CAP unique Candidates materialized against the baseline, then stops', async () => {
    const { unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error(JSON.stringify(unit))
    expect(unit.deliveries.map(d => d.action)).toEqual(['pooled', 'pooled', 'pooled'])
    expect(unit.pooled.map(p => p.ordinal)).toEqual([1, 2, 3])
    expect(new Set(unit.pooled.map(p => p.candidateStableKey)).size).toBe(3)
    for (const p of unit.pooled) {
      expect(p.reusedExisting).toBe(false)
      expect(p.replacement).toEqual({ status: 'ready', replacedBuildListEntryId: ENTRY_B })
      expect(candidateStableKey(p.generatedEntry!.candidateSnapshot)).toBe(p.candidateStableKey)
      expect(p.generatedEntry!.id).toBe(p.generatedBuildListEntryId)
      expect(p.reservationCheck.respects).toBe(true)
    }
    expect(unit.search).toMatchObject({ stoppedByConsumer: true, exhausted: false, stoppedByExtent: false, deliveredCandidates: 3 })
    expect(preflightSpy.calls).toEqual([])
  })

  it('never stops at found_R: Phase B stops at its first Candidate, D2 continues to the pool cap with the same first Candidate', async () => {
    const built = fixture()
    const resolved = phase2c27bResolveSupportContext(research(built), built.dependencies, TARGET_B, [])
    if (resolved.status !== 'ready') throw new Error('fixture')
    const phaseB = await runPhase2C27BTrialLoop(research(built), resolved.prepared, WIDE, PHASE2C27B_INITIAL_LADDER_STATE, built.dependencies)
    expect(phaseB.outcome).toBe('found_R')
    const foundAt = phaseB.found!.deliveryIndex
    expect(phaseB.deliveries).toHaveLength(foundAt + 1)
    const { unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    // The same Search order (Phase B's prefix, the found_R Candidate included), then D2 keeps going to the cap.
    expect(unit.deliveries.slice(0, foundAt + 1).map(d => d.candidateStableKey)).toEqual(phaseB.deliveries.map(d => d.stableKey))
    expect(unit.deliveries.length).toBeGreaterThan(foundAt + 1)
    expect(unit.pooled[foundAt]!.generatedBuildListEntryId).toBe(phaseB.found!.generatedBuildListEntryId)
    expect(codeOnly(mainSource)).not.toMatch(/found_R'\) return 'stop'|verdict\.status === 'found_R'/)
  })

  it('escalates an extent-bound rung and skips the stable keys pooled at a lower rung (duplicate_of_lower_rung)', async () => {
    const low = (await discover({ extent: SMALL })).unit
    if (low.status !== 'stopped_by_search_extent_bound') throw new Error(JSON.stringify(low))
    expect(low.pooled).toHaveLength(2)
    expect(d2DiscoveryNext(low.status, 'L0', 2)).toEqual({ next: 'L1', stop: null })
    const keys = low.pooled.map(p => p.candidateStableKey)
    const high = (await discover({ unitId: 'DSC-t00-L1', rung: 'L1', extent: WIDE, poolKeysAtStart: keys })).unit
    if (high.status !== 'discovery_cap_reached') throw new Error(JSON.stringify(high))
    expect(high.deliveries.map(d => d.action)).toEqual(['duplicate_of_lower_rung', 'duplicate_of_lower_rung', 'pooled'])
    expect(high.pooled.map(p => p.ordinal)).toEqual([3])
    expect(high.poolSizeAtStart).toBe(2)
    expect(high.deliveries.length).toBeLessThanOrEqual(D2_POOL_CAP)
  })

  it('classifies the unit outcome top to bottom and stops the Target on anything but an extent bound below the cap', () => {
    expect(d2DiscoveryUnitOutcome({ exhausted: false, stoppedByExtent: false }, true, 'L0')).toBe('discovery_cap_reached')
    expect(d2DiscoveryUnitOutcome({ exhausted: true, stoppedByExtent: false }, false, 'L1')).toBe('discovery_exhausted')
    expect(d2DiscoveryUnitOutcome({ exhausted: false, stoppedByExtent: true }, false, 'L1')).toBe('stopped_by_search_extent_bound')
    expect(d2DiscoveryUnitOutcome({ exhausted: false, stoppedByExtent: true }, false, 'L2')).toBe('ladder_exhausted')
    expect(d2DiscoveryNext('stopped_by_search_extent_bound', 'L1', 0)).toEqual({ next: 'L2', stop: null })
    expect(d2DiscoveryNext('ladder_exhausted', 'L2', 1)).toEqual({ next: null, stop: 'ladder_exhausted' })
    expect(d2DiscoveryNext('discovery_exhausted', 'L0', 0)).toEqual({ next: null, stop: 'discovery_exhausted' })
    expect(d2DiscoveryNext('discovery_cap_reached', 'L0', 3)).toEqual({ next: null, stop: 'discovery_cap_reached' })
    for (const s of ['timeout', 'out_of_memory', 'process_failure', 'interrupted', 'discovery_calculation_error'] as const) expect(d2DiscoveryNext(s, 'L0', 1)).toEqual({ next: null, stop: 'unmeasured' })
    expect(d2DiscoveryNext('not_executed', 'L1', 1)).toEqual({ next: null, stop: 'not_executed' })
  })

  it('records a typed Search error as discovery_calculation_error, never as a measured outcome', async () => {
    const { unit } = await discover({ targetWeaponId: TARGET_A, currentBuildListEntryId: ENTRY_A, extent: { maxNormalAdvance: 2, maxGogmaAdvance: 10, maxSkillAdvance: 5 } })
    expect(unit.status).toBe('discovery_calculation_error')
  })
})

// ---------------------------------------------------------------- evaluations (§3 / §6.1)

const replacementOf = (entry: BuildListEntry, targetIndex: number, current: string, support: string[] = [], digest: string | null = null): D2ReplacementTask => ({ targetIndex,
  targetWeaponId: entry.targetWeaponId, currentBuildListEntryId: current, generatedBuildListEntryId: entry.id, generatedEntrySha256: 'sha', generatedEntryFile: 'g.json', requiresSupport: support, supportReservationDigest: digest })
const evalTask = (stage: D2EvaluationTask['stage'], replacements: D2ReplacementTask[]): D2EvaluationTask => ({ evaluationId: stage, stage,
  evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', replacements, researchMaxPlanSteps: 20_000, fullRunCap: 8 })

describe('D2 evaluations (§3 / §6.1)', () => {
  it('records exactly the D1 facts and digests (same parts, same order) plus the D2 records, with no fixed constraint (G1)', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const g = unit.pooled[0]!.generatedEntry!
    const d2 = await runD2Evaluation(research(built), built.input.buildListEntries, evalTask('ADM', [replacementOf(g, 0, ENTRY_B)]), [g], built.dependencies)
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    const d1Task: D1EvaluationTask = { evaluationId: 'S', stage: 'S', evaluatedAgainst: 'baseline', replacements: [{ targetIndex: 0, targetWeaponId: TARGET_B, currentBuildListEntryId: ENTRY_B,
      generatedBuildListEntryId: g.id, generatedEntrySha256: 'sha', requiresSupport: [], phaseBReservationDigest: '', phaseBReservation: null }], researchMaxPlanSteps: 20_000, fullRunCap: 8 }
    const d1 = await runD1Evaluation(research(built), built.input.buildListEntries, d1Task, [g], built.dependencies)
    if (d2.status !== 'evaluated' || d1.status !== 'evaluated') throw new Error('fixture')
    const { rejectedBuildListEntries, resourceConflictRejections, selectedTargetWeaponIds, ...shared } = d2
    expect(shared).toEqual(d1)
    expect(d2.resultDigest).toBe(d1ResultDigest(d2))
    // The Phase B found_R judgement rides along as a diagnostic (here the first K0 Candidate is the one Phase B rejected).
    expect(['found_R', 'rejected']).toContain(d2.trialVerdict?.status)
    expect(Array.isArray(rejectedBuildListEntries)).toBe(true)
    expect(resourceConflictRejections).toBe(rejectedBuildListEntries.filter(r => r.reason === 'resource_conflict').length)
    expect(selectedTargetWeaponIds.length).toBeGreaterThan(0)
    const b0 = await runD2Evaluation(research(built), built.input.buildListEntries, evalTask('B0', []), [], built.dependencies)
    expect(b0.status === 'evaluated' && b0.baselineSummary !== null && b0.preflight.status === 'not_run').toBe(true)
  })

  it('never puts two Candidates of one Target into one PlannerInput (G15)', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const [g1, g2] = [unit.pooled[0]!.generatedEntry!, unit.pooled[1]!.generatedEntry!]
    const result = await runD2Evaluation(research(built), built.input.buildListEntries, evalTask('CMP', [replacementOf(g1, 0, ENTRY_B), replacementOf(g2, 0, ENTRY_B)]), [g1, g2], built.dependencies)
    expect(result).toMatchObject({ status: 'guardrail_violation' })
    expect(preflightSpy.calls).toEqual([])
  })

  it('checks S4 / S5 of a support Entry statically and fails a changed support as a guardrail violation', async () => {
    const { built, unit } = await discover()
    if (unit.status !== 'discovery_cap_reached') throw new Error('fixture')
    const g = unit.pooled[0]!.generatedEntry!
    const digest = hashStableValue(derivePlannerAlternativeReservation([built.input.buildListEntries.find(e => e.id === ENTRY_A)!], built.dependencies.rngEngine))
    const ok = await runD2Evaluation(research(built), built.input.buildListEntries, evalTask('Z0', [replacementOf(g, 0, ENTRY_B, [ENTRY_A], digest)]), [g], built.dependencies)
    expect(ok.status === 'evaluated' && ok.supportChecks[ENTRY_A]).toEqual({ S1: true, S2: true, S3: true, S4: true, S5: true })
    const s5 = await runD2Evaluation(research(built), built.input.buildListEntries, evalTask('Z0', [replacementOf(g, 0, ENTRY_B, [ENTRY_A], 'fnv1a32:00000000')]), [g], built.dependencies)
    expect(s5.status === 'guardrail_violation' && s5.issues.join()).toMatch(/^S5/)
    const changed = built.input.buildListEntries.map(e => e.id === ENTRY_A ? { ...e, memo: 'changed' } : e)
    expect((await runD2Evaluation(research(built), changed, evalTask('Z0', [replacementOf(g, 0, ENTRY_B, [ENTRY_A], digest)]), [g], built.dependencies)).status).toBe('guardrail_violation')
  })

  it('judges R1 from the discovery and the admission run only; R2..R4 are diagnostics derived from it', () => {
    const facts = (termination: string, selected: string[]) => ({ preflight: { status: 'ready', refusal: null }, conflicts: [],
      plan: { present: true, termination: { status: termination, completedTargetCount: 20, totalTargetCount: 43, reachedLimits: [] }, steps: 1, selectedBuildListEntryIds: selected, warningKinds: [] } })
    const ok = { reusedExisting: false, replacementReady: true }
    expect(d2R1R4('evaluated', facts('exhausted', ['g']), 'g', [], ok)).toMatchObject({ R1: true, R2: true, R3: true, R4: true, supportVacuous: true })
    expect(d2R1R4('evaluated', facts('exhausted', ['x']), 'g', [], ok)).toMatchObject({ R1: true, R3: false, R4: false })
    expect(d2R1R4('evaluated', facts('incomplete', ['g']), 'g', [], ok)).toMatchObject({ R1: false, R1FailureReason: 'plan_bound_truncated' })
    expect(d2R1R4('not_run_reused_existing', null, 'g', [], { reusedExisting: true, replacementReady: true })).toMatchObject({ R1: false, R1FailureReason: 'reused_existing' })
    expect(d2R1R4('preflight_refused', { ...facts('exhausted', []), preflight: { status: 'unresolved', refusal: 'x' } }, 'g', [], ok)).toMatchObject({ R1: false, R1FailureReason: 'preflight_refused' })
  })
})

// ---------------------------------------------------------------- composition (§4) and R6 (§6.4)

const stepEval = (id: string, ordinal: number, over: Partial<D2StepEvaluation> = {}): D2StepEvaluation => ({ evaluationId: id, ordinal, status: 'evaluated', r5Satisfied: true, completed: 21, conflicts: 21, steps: 100, ...over })

describe('D2 composition (§4.1 - §4.3) and R6', () => {
  it('accepts only R5 ∧ gate, never R5 alone (r5OnlyEligible), and never re-judges with the admission result', () => {
    expect(d2GateSatisfied(20, 20)).toBe(true)
    expect(d2GateSatisfied(19, 20)).toBe(false)
    expect(d2GateSatisfied(null, 20)).toBe(false)
    expect(d2CompositionStep([stepEval('c1', 1, { completed: 19 }), stepEval('c2', 2, { r5Satisfied: false, completed: 25 })], 20))
      .toEqual({ stepOutcome: 'not_replaced_no_eligible', eligible: [], r5OnlyEligible: ['c1'], chosen: null })
    expect(d2CompositionStep([], 20)).toEqual({ stepOutcome: 'not_replaced_no_admitted', eligible: [], r5OnlyEligible: [], chosen: null })
    expect(d2CompositionStep([stepEval('c1', 1), stepEval('c2', 2, { status: 'timeout', r5Satisfied: null, completed: null, conflicts: null, steps: null })], 20).stepOutcome).toBe('step_unmeasured')
    expect(d2CompositionStep([stepEval('c1', 1, { status: 'preflight_refused', r5Satisfied: false }), stepEval('c2', 2)], 20)).toMatchObject({ stepOutcome: 'accepted', chosen: 'c2' })
  })

  it('selects by completed desc, Conflicts asc, steps asc, then discovery ordinal', () => {
    const pick = (list: D2StepEvaluation[]) => d2CompositionStep(list, 20).chosen
    expect(pick([stepEval('c1', 1, { completed: 21 }), stepEval('c2', 2, { completed: 22, conflicts: 30 })])).toBe('c2')
    expect(pick([stepEval('c1', 1, { conflicts: 21 }), stepEval('c2', 2, { conflicts: 19, steps: 999 })])).toBe('c2')
    expect(pick([stepEval('c1', 1, { steps: 200 }), stepEval('c2', 2, { steps: 150 })])).toBe('c2')
    expect(pick([stepEval('c2', 2), stepEval('c3', 3), stepEval('c1', 1)])).toBe('c1')
    expect(compareD2Selection({ evaluationId: 'a', ordinal: 1, completed: 1, conflicts: 1, steps: 1 }, { evaluationId: 'b', ordinal: 2, completed: 1, conflicts: 1, steps: 1 })).toBeLessThan(0)
  })

  it('R6 needs 43 / 43 completed, Conflict 0, no resource_conflict rejection, a Plan and R5', () => {
    const facts = (over: { status?: string; completed?: number; conflicts?: number; rc?: number } = {}) => ({ plan: { present: true, termination: { status: over.status ?? 'completed', completedTargetCount: over.completed ?? 43,
      totalTargetCount: 43, reachedLimits: [] }, steps: 1, selectedBuildListEntryIds: [], warningKinds: [] }, conflicts: Array.from({ length: over.conflicts ?? 0 }, () => ({}) as never), resourceConflictRejections: over.rc ?? 0 })
    const r6 = (f: ReturnType<typeof facts>, r5 = true) => judgeD2R6({ status: 'evaluated', evaluatedAgainst: 'replacement_set', facts: f, r5Satisfied: r5 }).satisfied
    expect(r6(facts())).toBe(true)
    expect(r6(facts(), false)).toBe(false)
    expect(r6(facts({ completed: 42 }))).toBe(false)
    expect(r6(facts({ status: 'exhausted' }))).toBe(false)
    expect(r6(facts({ conflicts: 1 }))).toBe(false)
    expect(r6(facts({ rc: 1 }))).toBe(false)
    expect(judgeD2R6({ status: 'evaluated', evaluatedAgainst: 'baseline', facts: facts(), r5Satisfied: true }).judged).toBe(false)
    expect(judgeD2R6({ status: 'timeout', evaluatedAgainst: 'replacement_set', facts: null, r5Satisfied: null }).judged).toBe(false)
  })

  it('classifies the main decision top to bottom, independently of the seeded axis', () => {
    const base = { invalidReasons: [], mainUnmeasured: [], finalAcceptedCount: 1, finalMetrics: { completed: 21, conflicts: 21, steps: 1 }, finalR6: false, boundLimitedEvaluations: [], newCandidateAccepted: 1 }
    expect(classifyD2Decision({ ...base, invalidReasons: [{ category: 'd1_parity', detail: 'x' }] }).case).toBe('D2A_INVALID')
    expect(classifyD2Decision({ ...base, mainUnmeasured: ['CMP-t02-c1'] })).toMatchObject({ case: 'D2A_INCOMPLETE', lowerBound: true })
    expect(classifyD2Decision({ ...base, finalR6: true }).case).toBe('D2A_GLOBAL_COMPLETE_R')
    expect(classifyD2Decision({ ...base, finalMetrics: { completed: 22, conflicts: 20, steps: 1 } }).case).toBe('D2A_EXCEEDS_D1_INCUMBENT')
    expect(classifyD2Decision({ ...base, finalMetrics: { completed: 22, conflicts: 21, steps: 1 } })).toMatchObject({ case: 'D2A_IMPROVED_OVER_BASELINE', equalsD1IncumbentMetrics: true })
    expect(classifyD2Decision({ ...base, finalAcceptedCount: 0, finalMetrics: { completed: 20, conflicts: 21, steps: 1 } }).case).toBe('D2A_NO_IMPROVEMENT')
    const z = { invalid: false, seededUnmeasured: [], z0ParityState: 'matched' as const, addedTargets: [], finalMetrics: null, finalR6: false }
    expect(classifyD2SeededDecision({ ...z, invalid: true }).case).toBeNull()
    expect(classifyD2SeededDecision({ ...z, seededUnmeasured: ['Z0'], z0ParityState: 'not_checked' }).case).toBe('D2A_Z_INCOMPLETE')
    expect(classifyD2SeededDecision({ ...z, addedTargets: ['t00'] }).case).toBe('D2A_Z_EXTENDS_D1_INCUMBENT')
    expect(classifyD2SeededDecision(z).case).toBe('D2A_Z_NO_EXTENSION')
  })
})

// ---------------------------------------------------------------- parity primitives (§7.3)

describe('D2 parity primitives (§7.3)', () => {
  const found = { phaseBUnitId: 't00-r01-L1', rung: 'L1' as const, result: 'found_R' as const, firstKeySha256: 'k', firstCost: 1 }
  const extent = { phaseBUnitId: 't00-r01-L0', rung: 'L0' as const, result: 'stopped_by_search_extent_bound' as const, firstKeySha256: null, firstCost: null }
  it('gives the four states: matched, mismatched (a different key, a missing delivery, a typed error), not_checked (unmeasured)', () => {
    expect(d2PhaseBPrefixParity(found, { comparable: true, status: 'discovery_cap_reached', deliveredCandidates: 3, firstKeySha256: 'k' }).state).toBe('matched')
    expect(d2PhaseBPrefixParity(found, { comparable: true, status: 'discovery_cap_reached', deliveredCandidates: 3, firstKeySha256: 'x' }).state).toBe('mismatched')
    expect(d2PhaseBPrefixParity(found, { comparable: true, status: 'discovery_exhausted', deliveredCandidates: 0, firstKeySha256: null }).state).toBe('mismatched')
    expect(d2PhaseBPrefixParity(found, { comparable: true, status: 'discovery_calculation_error', deliveredCandidates: null, firstKeySha256: null }).state).toBe('mismatched')
    expect(d2PhaseBPrefixParity(found, { comparable: false, status: 'timeout', deliveredCandidates: null, firstKeySha256: null }).state).toBe('not_checked')
    expect(d2PhaseBPrefixParity(extent, { comparable: true, status: 'stopped_by_search_extent_bound', deliveredCandidates: 0, firstKeySha256: null }).state).toBe('matched')
    expect(d2PhaseBPrefixParity(extent, { comparable: true, status: 'discovery_exhausted', deliveredCandidates: 0, firstKeySha256: null }).state).toBe('mismatched')
    expect(d2PhaseBPrefixParity(extent, { comparable: true, status: 'stopped_by_search_extent_bound', deliveredCandidates: 1, firstKeySha256: 'k' }).state).toBe('mismatched')
    expect(d2D1GeneratedParity({ keySha256: 'k', buildListEntryId: 'g', sha256: 's' }, { keySha256: 'k', generatedBuildListEntryId: 'g', generatedEntrySha256: 's' }).state).toBe('matched')
    expect(d2D1GeneratedParity({ keySha256: 'k', buildListEntryId: 'g', sha256: 's' }, null).state).toBe('mismatched')
    expect(d2D1GeneratedParity({ keySha256: 'k', buildListEntryId: 'g', sha256: 's' }, { keySha256: 'k', generatedBuildListEntryId: 'g', generatedEntrySha256: 'other' }).mismatches).toEqual(['G store SHA-256'])
  })
})

// ---------------------------------------------------------------- the run analysis (a synthetic run of 3 Targets; t01 is the K1 seed)

const EXPORT = 'e'.repeat(64)
const T = ['target.d2.t0', 'target.d2.t1', 'target.d2.t2']
const O = ['entry.d2.o0', 'entry.d2.o1', 'entry.d2.o2']
const G0 = 'entry.d2.g0', G2 = 'entry.d2.g2', Z1 = 'entry.d2.z1', SUP = 'entry.d2.sup'
const GSHA0 = fakeSha('g0'), GSHA2 = fakeSha('g2'), ZSHA = fakeSha('z1')
const CTX = { calculationContext: { ...D2_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000 }
const SUMMARY = { planningTargetCount: 43, completedTargetCount: 20, termination: 'exhausted', planSteps: 1, selectedTargets: [], conflicts: 21, conflictsByKind: {}, conflictSignatures: [] }
const dummyConflicts = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'same_gogma_counter', participants: [`x${i}a`, `x${i}b`] }))

function facts(o: { selected: string[]; completed: number; conflicts?: { kind: string; participants: string[] }[]; support?: Record<string, { S1: boolean; S2: boolean; S3: boolean; S4: boolean; S5: boolean }>; summary?: unknown }): D2EvaluationFacts {
  const f: D2EvaluationFacts = { preflight: { status: 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
    plan: { present: true, termination: { status: 'exhausted', completedTargetCount: o.completed, totalTargetCount: 43, reachedLimits: [] }, steps: 10 + o.completed, selectedBuildListEntryIds: [...o.selected].sort(), warningKinds: [] },
    conflicts: (o.conflicts ?? dummyConflicts(21)).map((c, i) => ({ id: `c${i}:${c.participants.join()}`, kind: c.kind, participants: [...c.participants].sort(), selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: null, resourceIdentityMatched: false })),
    routeCommitment: [], supportChecks: o.support ?? {}, trialRunSummary: null, trialVerdict: null, baselineSummary: (o.summary ?? null) as never, steps: [], resultDigest: '',
    rejectedBuildListEntries: [], resourceConflictRejections: 0, selectedTargetWeaponIds: [] }
  f.resultDigest = d1ResultDigest(f)
  return f
}

interface Synthetic {
  validated: D2ValidatedInputs
  discoveryRows: D2DiscoveryRow[]
  discoveryRecords: Map<string, Record<string, unknown> | null>
  poolFiles: Map<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: D2EvaluationRow[]
  evaluationRecords: Map<string, Record<string, unknown> | null>
  facts: Record<string, D2EvaluationFacts>
}

function synthetic(): Synthetic {
  const built = fixture()
  const snapshots = built.input.buildListEntries.map(e => e.candidateSnapshot)
  const keys = [candidateStableKey(snapshots[0]!), candidateStableKey(snapshots[1]!)]
  const bodies: Record<string, unknown> = { [G0]: { ...built.input.buildListEntries[0]!, id: G0, targetWeaponId: T[0] }, [G2]: { ...built.input.buildListEntries[1]!, id: G2, targetWeaponId: T[2] } }
  const support = { [SUP]: { S1: true, S2: true, S3: true, S4: true, S5: true } }
  const f: Record<string, D2EvaluationFacts> = {
    'B0': facts({ selected: O, completed: 20, summary: SUMMARY }),
    'ADM-t00-c1': facts({ selected: [G0, O[1]!, O[2]!], completed: 21 }),
    'ADM-t02-c1': facts({ selected: [O[0]!, O[1]!, G2], completed: 20 }),
    'CMP-t00-c1': facts({ selected: [G0, O[1]!, O[2]!], completed: 21 }),
    'CMP-t02-c1': facts({ selected: [G0, O[1]!, G2], completed: 20 }),
    'Z0': facts({ selected: [O[0]!, Z1, SUP, O[2]!], completed: 22, support }),
    'Z-t00-c1': facts({ selected: [G0, Z1, SUP, O[2]!], completed: 23, support }),
    'Z-t02-c1': facts({ selected: [G0, Z1, SUP], completed: 23, support }),
  }
  const validated: D2ValidatedInputs = { passed: true, issues: [], exportSha256: EXPORT, k0ReservationDigest: 'k0', phase2c2BaselineSummary: SUMMARY,
    targets: T.map((id, i) => ({ targetIndex: i, label: `t0${i}`, targetWeaponId: id, currentBuildListEntryId: O[i]!, phaseBK0Units: {}, firstK0DeliveryRung: null, d1Generated: null })),
    seed: [{ targetIndex: 1, label: 't01', targetWeaponId: T[1]!, currentBuildListEntryId: O[1]!, unitId: 'seed', file: 'seed.json', bytes: 1, sha256: ZSHA, generatedBuildListEntryId: Z1,
      requiresSupport: [SUP], supportReservationDigest: 'r', isK1Candidate: true }],
    d1: { b0: { inputDigest: d1InputDigest([], [], [], EXPORT), resultDigest: f.B0!.resultDigest }, aB: { inputDigest: d1InputDigest([T[1]!], [Z1], [ZSHA], EXPORT), resultDigest: f.Z0!.resultDigest, evaluationId: 'A-b' },
      byInputDigest: {} } }
  validated.targets[0]!.phaseBK0Units = { L0: { phaseBUnitId: 't00-r01-L0', rung: 'L0', result: 'found_R', firstKeySha256: syncSha(keys[0]!), firstCost: 5 } }
  validated.targets[0]!.firstK0DeliveryRung = 'L0'
  validated.targets[0]!.d1Generated = { buildListEntryId: G0, sha256: GSHA0, evaluationId: 'S-t00' }
  validated.d1!.byInputDigest[validated.d1!.b0.inputDigest] = [{ evaluationId: 'B0', status: 'evaluated', resultDigest: f.B0!.resultDigest }]
  validated.d1!.byInputDigest[validated.d1!.aB.inputDigest] = [{ evaluationId: 'A-b', status: 'evaluated', resultDigest: f.Z0!.resultDigest }]

  const discoveryRows: D2DiscoveryRow[] = [], discoveryRecords = new Map<string, Record<string, unknown> | null>(), poolFiles = new Map<string, { bytes: number; sha256: string; body: unknown } | null>()
  const unit = (i: number, pooled: { key: string; g: string; sha: string; file: string }[]) => {
    const unitId = `DSC-t0${i}-L0`
    discoveryRows.push({ unitId, targetIndex: i, rung: 'L0', status: 'discovery_exhausted', notExecutedReason: null, process: { outcome: 'completed', wallMs: 1, startedAt: '2026-10-10T00:00:00.000Z' }, recordFile: { file: `${unitId}.record.json`, bytes: 1, sha256: 'r' } })
    discoveryRecords.set(unitId, { ...CTX, result: { status: 'discovery_exhausted', unitId, poolSizeAtStart: 0, originDigest: 'o', reservationDigest: 'k0', excludedRouteKeys: [],
      deliveries: pooled.map((p, k) => ({ indexInUnit: k, candidateStableKey: p.key, cost: 5, action: 'pooled', reservationCheck: { respects: true }, keySha256: syncSha(p.key) })),
      pooled: pooled.map((p, k) => ({ ordinal: k + 1, indexInUnit: k, candidateStableKey: p.key, cost: 5, routeKind: 'existing_gogma_mixed', routeOperationCount: 2, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] },
        searchIdentity: 'si', generatedBuildListEntryId: p.g, reusedExisting: false, replacement: { status: 'ready', replacedBuildListEntryId: O[i] }, generatedEntry: null, generatedEntryFile: { file: p.file, bytes: 1, sha256: p.sha }, keySha256: syncSha(p.key) })),
      search: { deliveredCandidates: pooled.length, excludedCandidates: 0, exhausted: true, stoppedByExtent: false, stoppedByConsumer: false, skippedExcludedRouteKeys: 0 }, timing: { searchOnlyMs: 1 } } })
    for (const p of pooled) poolFiles.set(p.file, { bytes: 1, sha256: p.sha, body: bodies[p.g] })
  }
  unit(0, [{ key: keys[0]!, g: G0, sha: GSHA0, file: 't00-c1.generated-entry.json' }])
  unit(1, [])
  unit(2, [{ key: keys[1]!, g: G2, sha: GSHA2, file: 't02-c1.generated-entry.json' }])

  const evaluationRows: D2EvaluationRow[] = [], evaluationRecords = new Map<string, Record<string, unknown> | null>()
  const ref = { 0: { g: G0, sha: GSHA0, support: [] as string[] }, 1: { g: Z1, sha: ZSHA, support: [SUP] }, 2: { g: G2, sha: GSHA2, support: [] as string[] } } as const
  const evalRow = (id: string, stage: D2EvaluationRow['stage'], targetIndex: number | null, poolOrdinal: number | null, indexes: number[]) => {
    const reps = indexes.map(i => ref[i as 0 | 1 | 2])
    const support = [...new Set(reps.flatMap(r => r.support))].sort()
    const row: D2EvaluationRow = { evaluationId: id, stage, axis: stage === 'CMP' || stage === 'ADM' ? 'main' : stage === 'B0' ? 'none' : 'seeded',
      evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'ADM' ? 'baseline' : 'replacement_set', targetIndex, poolOrdinal, replacementTargetIndexes: indexes,
      replacementTargets: indexes.map(i => T[i]!), generatedEntryIds: reps.map(r => r.g), generatedEntrySha256s: reps.map(r => r.sha), requiresSupport: support,
      inputDigest: d1InputDigest(indexes.map(i => T[i]!), reps.map(r => r.g), reps.map(r => r.sha), EXPORT), status: 'evaluated', notExecutedReason: null,
      process: { outcome: 'completed', wallMs: 1, startedAt: '2026-10-10T00:00:01.000Z' }, recordFile: { file: `${id}.record.json`, bytes: 1, sha256: 'r' }, runner: null }
    evaluationRows.push(row)
    evaluationRecords.set(id, { ...CTX, result: { status: 'evaluated', ...f[id]! } })
  }
  evalRow('B0', 'B0', null, null, [])
  evalRow('ADM-t00-c1', 'ADM', 0, 1, [0])
  evalRow('ADM-t02-c1', 'ADM', 2, 1, [2])
  evalRow('CMP-t00-c1', 'CMP', 0, 1, [0])
  evalRow('CMP-t02-c1', 'CMP', 2, 1, [0, 2])
  evalRow('Z0', 'Z0', null, null, [1])
  evalRow('Z-t00-c1', 'Z', 0, 1, [0, 1])
  evalRow('Z-t02-c1', 'Z', 2, 1, [0, 1, 2])
  return { validated, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords, facts: f }
}

const analyze = (s: Synthetic, over: Partial<D2AnalysisInput> = {}) => analyzeD2Run({ validated: s.validated, exportSha256: EXPORT, discoveryRows: s.discoveryRows, discoveryRecords: s.discoveryRecords,
  poolFiles: s.poolFiles, evaluationRows: s.evaluationRows, evaluationRecords: s.evaluationRecords, compositionRows: null, interrupted: false, runEnvelopeReached: false, abortReason: null,
  provenanceIssues: [], evidenceIssues: [], rawConsistencyIssues: [], childProcessCount: null, sha256OfText: syncSha, ...over })
const unmeasure = (s: Synthetic, id: string, outcome: string) => {
  const row = s.evaluationRows.find(r => r.evaluationId === id)!
  Object.assign(row, { status: outcome, process: { outcome, wallMs: 1 }, recordFile: null })
  s.evaluationRecords.delete(id)
}
const notExecute = (s: Synthetic, id: string, reason: string) => {
  const row = s.evaluationRows.find(r => r.evaluationId === id)!
  Object.assign(row, { status: 'not_executed', notExecutedReason: reason, process: null, recordFile: null, inputDigest: null })
  s.evaluationRecords.delete(id)
}
/** Re-targets one synthetic evaluation row to another replacement set (what the runner writes when an earlier step changed). */
const setReplacements = (s: Synthetic, id: string, indexes: number[]) => {
  const refs: Record<number, [string, string]> = { 0: [G0, GSHA0], 1: [Z1, ZSHA], 2: [G2, GSHA2] }
  const row = s.evaluationRows.find(r => r.evaluationId === id)!
  Object.assign(row, { replacementTargetIndexes: indexes, replacementTargets: indexes.map(i => T[i]!), generatedEntryIds: indexes.map(i => refs[i]![0]), generatedEntrySha256s: indexes.map(i => refs[i]![1]),
    inputDigest: row.inputDigest === null ? null : d1InputDigest(indexes.map(i => T[i]!), indexes.map(i => refs[i]![0]), indexes.map(i => refs[i]![1]), EXPORT) })
}
const states = (r: ReturnType<typeof analyze>) => Object.fromEntries(r.parityChecks.map(c => [c.checkId, c.state]))

describe('D2 run analysis (§4 / §5 / §7.3 / §8.5 / §9)', () => {
  it('replays the discovery, the admission, both compositions and the decisions from the records', () => {
    const r = analyze(synthetic())
    expect(r.invalidReasons).toEqual([])
    expect(r.composition.main.steps.map(s => [s.label, s.stepOutcome, s.chosen])).toEqual([['t00', 'accepted', 'CMP-t00-c1'], ['t01', 'not_replaced_no_admitted', null], ['t02', 'not_replaced_no_eligible', null]])
    expect(r.composition.main.steps[2]!.r5OnlyEligible).toEqual(['CMP-t02-c1'])
    expect(r.composition.main.finalMetrics).toEqual({ completed: 21, conflicts: 21, steps: 31 })
    expect(r.decision).toMatchObject({ case: 'D2A_IMPROVED_OVER_BASELINE', newCandidateAccepted: 0, equalsD1IncumbentMetrics: false })
    expect(r.composition.seeded.steps.map(s => [s.label, s.stepOutcome])).toEqual([['t00', 'accepted'], ['t02', 'not_replaced_no_eligible']])
    expect(r.seededAxis).toMatchObject({ case: 'D2A_Z_EXTENDS_D1_INCUMBENT', addedTargets: ['t00'], z0ParityState: 'matched' })
    const s = states(r)
    expect([s['phase_b_k0_prefix:t00-r01-L0'], s['d1_generated_entry:t00'], s['baseline:B0'], s['z0:Z0'], s['determinism_d1:B0'], s['determinism_d1:Z0']]).toEqual(['matched', 'matched', 'matched', 'matched', 'matched', 'matched'])
    expect(Object.entries(s).filter(([k]) => k.startsWith('determinism_d2')).map(([, v]) => v)).toEqual(['matched'])
    const adm = r.evaluations.find(e => e.evaluationId === 'ADM-t00-c1')!
    expect(adm.r5).toMatchObject({ judged: false })
    expect((adm.r1r4 as { R1: boolean }).R1).toBe(true)
    expect(r.evaluations.find(e => e.evaluationId === 'CMP-t02-c1')).toMatchObject({ eligible: false, r5OnlyEligible: true, gate: { judged: true, referenceCompleted: 21, proposedCompleted: 20, satisfied: false } })
  })

  it('keeps the main decision when Z0 is unmeasured: the seeded axis alone becomes D2A_Z_INCOMPLETE and Z0 parity not_checked', () => {
    const s = synthetic()
    unmeasure(s, 'Z0', 'timeout')
    for (const id of ['Z-t00-c1', 'Z-t02-c1']) notExecute(s, id, 'z0_unmeasured')
    setReplacements(s, 'Z-t02-c1', [1, 2])
    const r = analyze(s)
    expect(JSON.stringify(r.invalidReasons)).toBe('[]')
    expect(r.decision.case).toBe('D2A_IMPROVED_OVER_BASELINE')
    expect(r.seededAxis.case).toBe('D2A_Z_INCOMPLETE')
    expect(states(r)['z0:Z0']).toBe('not_checked')
    expect(r.parityChecks.find(c => c.checkId === 'z0:Z0')!.notChecked).toEqual({ dependsOn: [{ id: 'Z0', status: 'timeout', unmeasuredReason: 'timeout', notExecutedReason: null }] })
  })

  it('makes a normally measured Z0 that differs from D1 A-b INVALID (d1_parity), and leaves Z uninterpreted', () => {
    const s = synthetic()
    const z0 = facts({ selected: [O[0]!, Z1, SUP, O[2]!], completed: 21, support: { [SUP]: { S1: true, S2: true, S3: true, S4: true, S5: true } } })
    s.evaluationRecords.set('Z0', { ...CTX, result: { status: 'evaluated', ...z0 } })
    const r = analyze(s)
    expect(r.decision.case).toBe('D2A_INVALID')
    expect(r.invalidReasons.map(x => x.category)).toContain('d1_parity')
    expect(r.seededAxis.case).toBeNull()
  })

  it('reads a timeout / OOM as unmeasured (INCOMPLETE, a lower bound), never as non-coexistence', () => {
    const s = synthetic()
    unmeasure(s, 'CMP-t02-c1', 'timeout')
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    expect(r.decision).toMatchObject({ case: 'D2A_INCOMPLETE', lowerBound: true })
    expect(r.composition.main.steps[2]!.stepOutcome).toBe('step_unmeasured')
    const oom = synthetic()
    Object.assign(oom.discoveryRows[2]!, { status: 'out_of_memory', process: { outcome: 'out_of_memory', wallMs: 1 }, recordFile: null })
    oom.discoveryRecords.delete('DSC-t02-L0')
    oom.evaluationRows = oom.evaluationRows.filter(e => !['ADM-t02-c1', 'CMP-t02-c1', 'Z-t02-c1'].includes(e.evaluationId))
    const o = analyze(oom)
    expect(o.invalidReasons).toEqual([])
    expect(o.decision.case).toBe('D2A_INCOMPLETE')
    expect(o.seededAxis.case).toBe('D2A_Z_INCOMPLETE')
    expect(o.composition.main.steps[2]).toMatchObject({ stepOutcome: 'step_unmeasured', stepNotEvaluatedReason: 'dependency_unmeasured' })
  })

  it('accepts run_envelope_reached only when the run envelope was reached', () => {
    const s = synthetic()
    notExecute(s, 'CMP-t02-c1', 'run_envelope_reached')
    expect(analyze(s, { runEnvelopeReached: true }).decision.case).toBe('D2A_INCOMPLETE')
    expect(analyze(s, { runEnvelopeReached: false }).invalidReasons.map(x => x.category)).toContain('raw_result_mismatch')
  })

  it('makes a missing or broken record of a completed child INVALID (evidence_integrity), never unmeasured', () => {
    const s = synthetic()
    s.evaluationRecords.delete('CMP-t00-c1')
    const r = analyze(s)
    expect(r.decision.case).toBe('D2A_INVALID')
    expect(r.invalidReasons.map(x => x.category)).toContain('evidence_integrity')
    const broken = synthetic()
    const rec = broken.evaluationRecords.get('ADM-t02-c1')!
    delete (rec.result as Record<string, unknown>).resultDigest
    expect(analyze(broken).invalidReasons.map(x => x.category)).toContain('evidence_integrity')
    const gone = synthetic()
    gone.poolFiles.set('t02-c1.generated-entry.json', null)
    expect(analyze(gone).invalidReasons.map(x => x.category)).toContain('evidence_integrity')
    expect(analyze(synthetic(), { evidenceIssues: ['x: the record file is not the one the journal recorded'] }).decision.case).toBe('D2A_INVALID')
  })

  it('treats an expired t09-like support as support_expired_R (R5 false, measured), not as an INVALID', () => {
    const s = synthetic()
    const expired = facts({ selected: [G0, Z1, SUP, O[2]!], completed: 23, support: { [SUP]: { S1: false, S2: true, S3: true, S4: true, S5: true } } })
    s.evaluationRecords.set('Z-t00-c1', { ...CTX, result: { status: 'evaluated', ...expired } })
    setReplacements(s, 'Z-t02-c1', [1, 2])
    const r = analyze(s)
    expect(r.invalidReasons).toEqual([])
    const z = r.evaluations.find(e => e.evaluationId === 'Z-t00-c1')!
    expect(z.r5).toMatchObject({ satisfied: false, failureReasons: ['support_expired_R'] })
    expect(r.composition.seeded.steps[0]!.stepOutcome).toBe('not_replaced_no_eligible')
  })

  it('gives every parity its state and turns only a normally measured mismatch into INVALID', () => {
    const prefix = synthetic()
    prefix.validated.targets[0]!.phaseBK0Units.L0!.firstKeySha256 = 'other'
    const p = analyze(prefix)
    expect(states(p)['phase_b_k0_prefix:t00-r01-L0']).toBe('mismatched')
    expect(p.invalidReasons.map(x => x.category)).toContain('phase_b_k0_parity')
    const g = synthetic()
    g.validated.targets[0]!.d1Generated!.buildListEntryId = 'entry.other'
    expect(analyze(g).invalidReasons.map(x => x.category)).toContain('d1_parity')
    const determinism = synthetic()
    determinism.evaluationRecords.set('CMP-t00-c1', { ...CTX, result: { status: 'evaluated', ...facts({ selected: [G0, O[1]!, O[2]!], completed: 22 }) } })
    expect(analyze(determinism).invalidReasons.map(x => x.category)).toContain('determinism')
    const d1 = synthetic()
    d1.validated.d1!.byInputDigest[d1.evaluationRows.find(e => e.evaluationId === 'ADM-t00-c1')!.inputDigest!] = [{ evaluationId: 'S-t00', status: 'evaluated', resultDigest: 'fnv1a32:00000000' }]
    expect(states(analyze(d1))['determinism_d1:ADM-t00-c1']).toBe('mismatched')
    const unmeasuredDsc = synthetic()
    Object.assign(unmeasuredDsc.discoveryRows[0]!, { status: 'timeout', process: { outcome: 'timeout', wallMs: 1 }, recordFile: null })
    unmeasuredDsc.discoveryRecords.delete('DSC-t00-L0')
    unmeasuredDsc.evaluationRows = unmeasuredDsc.evaluationRows.filter(e => !['ADM-t00-c1', 'CMP-t00-c1', 'Z-t00-c1'].includes(e.evaluationId))
    setReplacements(unmeasuredDsc, 'CMP-t02-c1', [2])
    // The singleton {t02} is ADM-t02-c1's input, so it must reproduce ADM-t02-c1 (determinism).
    unmeasuredDsc.evaluationRecords.set('CMP-t02-c1', structuredClone(unmeasuredDsc.evaluationRecords.get('ADM-t02-c1')!))
    setReplacements(unmeasuredDsc, 'Z-t02-c1', [1, 2])
    const u = analyze(unmeasuredDsc)
    expect(states(u)['phase_b_k0_prefix:t00-r01-L0']).toBe('not_checked')
    expect(states(u)['d1_generated_entry:t00']).toBe('not_checked')
    expect(u.invalidReasons).toEqual([])
    expect(u.decision.case).toBe('D2A_INCOMPLETE')
  })

  it('flags an aborted run without an INVALID reason and a non-registered evaluation order', () => {
    expect(analyze(synthetic(), { abortReason: 'x' }).invalidReasons.map(x => x.category)).toContain('raw_result_mismatch')
    const s = synthetic()
    const [a, b] = [s.evaluationRows[1]!, s.evaluationRows[2]!]
    s.evaluationRows[1] = b; s.evaluationRows[2] = a
    expect(analyze(s).invalidReasons.map(x => x.category)).toContain('guardrail')
  })
})

// ---------------------------------------------------------------- oracle isolation, sources and the RESULT schema (§8.3 / §10)

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

describe('D2 oracle isolation, sources and Production (§8.2 / §8.3 / G23 - G28)', () => {
  it('reaches no oracle, Phase B analysis or population-authority module from the runner, child or analyzer modules', () => {
    for (const entry of ['./plannerGlobalD2.ts', './plannerGlobalD2Analysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalD1.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound/.test(f))).toEqual([])
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD2.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts',
      '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD2.ts', '/src/benchmarks/plannerGlobalD2Analysis.ts'])
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|_1657_/)
  })

  it('hard-codes no Target, Entry, reservation digest or stable key anywhere in the D2 code', () => {
    const rows = parseD1SpecTables(d1Document).found
    const values = rows.flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.generatedBuildListEntryId, ...r.supportBuildListEntryIds, r.reservationDigest])
    expect(values).toHaveLength(45)
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|fnv1a32[-:][0-9a-f]{8}|build-list\./)
      for (const id of values) expect(source).not.toContain(id.replace(/^build-list\.(constrained\.)?/, '').slice(0, 16))
    }
  })

  it('discovers with K0 only and writes no resolution, lineage or selected Entry anywhere (G1 / G23)', () => {
    expect(codeOnly(mainSource)).toMatch(/phase2c27bResolveSupportContext\(input, dependencies, task\.targetWeaponId, \[\]\)/)
    expect(codeOnly(mainSource)).toMatch(/preparePlannerReplacementConflictPreflight\(augmented, replacements, \[\], contexts, dependencies\)/)
    expect(codeOnly(mainSource)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|runPlannerAlternativeKernel|mergePlannerConflictScenarioResolution/)
  })

  it('is never imported by Production and counts Production source changes by the registered rule', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD2/.test(source)).map(([path]) => path)).toEqual([])
    expect(d2ProductionChangedFiles(['src/benchmarks/plannerGlobalD2.ts', 'scripts/run-planner-global-d2.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d2ProductionChangedFiles(['src/domain/planner/x.ts'])).toEqual(['src/domain/planner/x.ts'])
  })

  it('writes every §10 required RESULT field in the analyzer', () => {
    for (const field of ['phase:', 'analyzedAt:', 'sources:', 'specDocument:', 'phaseB:', 'phase2c2Result:', 'generatedEntriesUsedBySeed:', 'export:', 'documents:', 'provenance:', 'formal,', 'measuredHead,',
      'analysisHead,', 'measuredHeadIsAncestor,', 'runStatus,', 'benchmarkCodeSha256,', 'registeredPolicySha256,', 'calculationCodeChangedSinceMeasuredHead,', 'productionChangedFiles:', 'startAttestation:',
      'phaseBMeasuredHead:', 'd1MeasuredHead:', 'D2_PROVENANCE_FLAGS', 'phaseBResultFieldsRead:', 'd1ResultFieldsRead:', 'phaseBResultModified:', 'd1ResultModified:', 'environment:', 'conditions:',
      'poolCap:', 'discoveryRule:', 'admissionRule:', 'compositionRule:', 'gate:', 'selectionOrder:', 'seededAxis:', 'budgets:', 'order:', 'executionEnvelope:', 'researchMaxPlanSteps:',
      'evaluationFullRunCap:', 'r5Definition:', 'r6Definition:', 'supportChecks:', 'decisionRule:', 'comparisonBaselines:', 'notRun:', 'inputValidation:', 'discovery:', 'evaluations:', 'parityChecks:',
      'composition:', 'comparison:', 'aggregates:', 'timing:', 'memory:', 'invalidReasons:', 'decision:']) expect(analyzerSource).toContain(field)
    for (const flag of ['oracleReadByRunner', 'oracleReadByChild', 'oracleReadByAnalyzer', 'oracleGuidedTargetPopulation', 'inheritsOracleInformedExtentLadder', 'inheritsOracleInformedExecutionEnvelope',
      'speculativeSupportWrittenAsResolution', 'k1SupportInDiscovery', 'seededAxisUsesD1Incumbent', 'seededAxisIncludesK1Candidate', 'productionSemanticsChanged']) expect(mainSource).toContain(`${flag}:`)
    const r = analyze(synthetic())
    expect(Object.keys(r).sort()).toEqual(['aggregates', 'comparison', 'composition', 'decision', 'discovery', 'evaluations', 'invalidReasons', 'mainUnmeasured', 'parityChecks', 'seededAxis', 'seededUnmeasured'])
    expect(Object.keys(r.decision).sort()).toEqual(['boundLimitedEvaluations', 'case', 'equalsD1IncumbentMetrics', 'exceedsD1ObservedUnderIncomplete', 'globalCompleteObservedUnderIncomplete', 'lowerBound', 'newCandidateAccepted', 'reasons'])
    expect(Object.keys(r.seededAxis).sort()).toEqual(['addedTargets', 'case', 'finalMetrics', 'lowerBound', 'reasons', 'z0ParityState'])
    for (const e of r.evaluations) for (const k of ['stage', 'axis', 'poolOrdinal', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'referenceDiff', 'gate', 'r5OnlyEligible', 'eligible', 'r6', 'd1Parity', 'inputDigest', 'resultDigest', 'r5', 'candidates', 'conflicts']) expect(e).toHaveProperty(k)
    expect(Object.keys(r.comparison.d1DroppedTargets[0]!).sort()).toEqual(['admittedCount', 'label', 'mainAcceptedIsNew', 'mainAcceptedOrdinal', 'mainOutcome', 'newAdmittedCount', 'newCandidatesFound', 'poolSize',
      'seededAcceptedIsNew', 'seededAcceptedOrdinal', 'seededOutcome', 'targetsGainedWhenAccepted', 'targetsLostWhenAccepted', 'winnersObserved'])
  })
})

// ---------------------------------------------------------------- start attestation (§8.2)

const observation = () => ({ createdAt: '2026-10-11T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d2.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D2_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? 'e'.repeat(64) }])),
  observedSeedFiles: Object.fromEntries(D2_SEED_FILES.map(s => [s.unitId, { bytes: s.bytes, sha256: s.sha256 }])), exportFileName: D2_REGISTERED_INPUTS.export.file,
  productionAudit: { baseMain: D2_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 },
  appliedExecutionEnvelope: { ...D2_EXECUTION_ENVELOPE }, rngEngineVersion: 'production-rng:c5-e7', smoke: null })
const expectation = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), registeredPolicySha256: 'd'.repeat(64), exportSha256: 'e'.repeat(64), firstChildStartedAt: '2026-10-11T00:00:01.000Z' }

describe('D2 start attestation', () => {
  it('verifies a clean formal launch and fails on any drift', () => {
    const verify = (patch: object, exp = expectation) => verifyD2StartAttestation(JSON.parse(JSON.stringify({ ...d2StartAttestationBody(observation()), ...patch })), exp)
    expect(verify({})).toEqual({ verified: true, issues: [] })
    expect(verify({ productionAudit: { baseMain: D2_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { targetIndexes: [1], maxChildren: null, budgetMs: null } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ poolCap: 4 }).issues).toContain('poolCap differs from the registered condition')
    expect(verify({ appliedExecutionEnvelope: { ...D2_EXECUTION_ENVELOPE, runBudgetMs: 1 } }).verified).toBe(false)
    expect(verify({ rngEngineVersion: 'production-rng:c5-e8' }).verified).toBe(false)
    expect(verify({ observedSeedFiles: {} }).verified).toBe(false)
    expect(verify({}, { ...expectation, registeredPolicySha256: 'f'.repeat(64) }).issues).toContain('registeredPolicySha256 differs')
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-10T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
