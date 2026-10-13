import { describe, expect, it } from 'vitest'
import golden from '../../test/fixtures/globalAssignmentMaterializationV1GoldenPreD0A2B.json'
import { hashStableValue } from '../../domain/models/publicTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { createGlobalAssignmentContext } from './context'
import { deriveD0cPublicResult } from './materializationFormalResult'
import { d0cFixtureConditions, d0cFixtureSources } from './materializationFormalTestFixture'
import type { MaterializationRunConditions } from './materializationProtocol'
import { runMaterializationSmoke, summarizeMaterializationRun, type MaterializationRunExecution, type MaterializedEntriesHandoff } from './materializationRunner'
import { ELEMENT_A, ELEMENT_B, materializationScenario, OPEN_GATE, TARGET, type MaterializationScenarioSpec } from './materializationTestFixture'
import { V1_GOLDEN_RUNNER_SPECS, v1GoldenConditions } from './materializationV1GoldenTestFixture'
import { shapeCapturingPort } from './shapeMaterializationTestFixture'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'
import {
  compareD0cMaterializationIdentity, createD1aEntrySet, D1A_ENTRY_SET_KIND, D1A_INCUMBENT_PHYSICAL_OPERATIONS, D1A_NONFORMAL_CONDITIONS, d1aEnvelopeIssues, d1aEntrySetIssues,
  d1aOperationCountReading, differingSemanticFields, handoffFromEntrySet, judgeD1aRun, materializedEntriesFingerprintOfHandoffs, materializedEntriesFingerprintOfSemantic, parseD1aJournal,
  type D1aFirstProcessView, type D1aFreshProcessView, type D1aVerificationView,
} from './verificationProtocol'
import { verifyPlannerCandidate, type PlannerVerificationSemantic } from './verify'
import { execution, TEST_CONDITIONS } from './verificationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-1A: the materialization runner hands its Entry bodies over without changing either record
 * (the d0a-v1 golden and the d0a2-v2 records are byte-identical with the callback), the D-0C identity check of a re-run, the Entry
 * set of the fresh process, the judgement of one run from its two processes (one side alone is never verified; a stopped process is
 * unmeasured), the non-formal conditions and the journal. A whole run without child processes ends `verified` on a synthetic scenario.
 */

const SHAPE_SPEC: MaterializationScenarioSpec = {
  targets: ['a', 'b'],
  owned: [ownedGogma('owned.g1', { seriesSkillId: 'series_skill.fixture.a' })],
  skillIdeal: { [ELEMENT_B]: [7] },
  reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
  window: { skill: 3, gogma: 5, normal: 2 },
}
const SHAPE_CONDITIONS = d0cFixtureConditions({ projectedSearchScaleGate: OPEN_GATE })
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
/** Stands in for SHA-256 here (`src` imports no Node module); the script hashes with SHA-256. */
const textHash = (value: unknown) => hashStableValue(JSON.stringify(value))

async function materializationRun(spec: MaterializationScenarioSpec, conditions: MaterializationRunConditions, extra: Partial<MaterializationRunExecution> = {}) {
  const scene = await materializationScenario(spec)
  let tick = 0
  const handoffs: MaterializedEntriesHandoff[] = []
  const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1), onMaterializedEntries: handoff => { handoffs.push(handoff) }, ...extra })
  return { scene, result, handoffs }
}

describe('Phase D-1A: the materialization runner hands its Entries over without changing its records', () => {
  it('keeps every frozen d0a-v1 runner record verbatim with the callback present, and hands over the recorded Entries', async () => {
    const frozen = golden as Record<string, unknown>
    const cases: [string, MaterializationScenarioSpec, MaterializationRunConditions][] = [
      ['runner.held_crossing', V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions()],
      ['runner.policy_first.limit3', V1_GOLDEN_RUNNER_SPECS.policy_first, v1GoldenConditions({ structuralCandidateLimit: 3 })],
      ['runner.held_crossing.gate', V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions({ searchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } })],
      ['runner.held_crossing.cap1', V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions({ deliveryCap: 1, structuralCandidateLimit: 2 })],
    ]
    for (const [key, spec, conditions] of cases) {
      const { result, handoffs } = await materializationRun(spec, conditions)
      expect(JSON.stringify(plain({ semantic: result.semantic, summary: summarizeMaterializationRun(result.semantic) })), key).toBe(JSON.stringify(frozen[key]))
      // One handoff per materialized candidate, carrying exactly the Entries the record identifies.
      expect(handoffs.map(handoff => handoff.candidateIndex), key).toEqual(result.semantic.candidates.filter(candidate => candidate.stage !== null).map(candidate => candidate.candidate.candidateIndex))
      expect(materializedEntriesFingerprintOfHandoffs(handoffs), key).toBe(materializedEntriesFingerprintOfSemantic(result.semantic))
    }
  }, 120_000)

  it('gives the same d0a2-v2 semantic and observed records and the same Searches with and without the callback (no second materialization)', async () => {
    const withCallback = shapeCapturingPort()
    const withoutCallback = shapeCapturingPort()
    const on = await materializationRun(SHAPE_SPEC, SHAPE_CONDITIONS, { shapeSearch: withCallback.port })
    const scene = await materializationScenario(SHAPE_SPEC)
    let tick = 0
    const off = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions: SHAPE_CONDITIONS }, { now: () => (tick += 1), shapeSearch: withoutCallback.port })
    expect(JSON.stringify(on.result.semantic)).toBe(JSON.stringify(off.semantic))
    expect(JSON.stringify(on.result.observed)).toBe(JSON.stringify(off.observed))
    expect(withCallback.seamInputs).toEqual(withoutCallback.seamInputs)
    expect(withCallback.searchInputs).toEqual(withoutCallback.searchInputs)
    // The handoff: the Phase 0 planning Targets, the candidate's objective and stream ends, and the recorded Entry bodies.
    expect(on.handoffs).toHaveLength(1)
    const [handoff] = on.handoffs
    const record = on.result.semantic.candidates[0]!
    expect(handoff).toMatchObject({ candidateIndex: 0, ordinal: record.candidate.ordinal, objective: record.candidate.objective, streamEnd: record.candidate.streamEnd, stage: { kind: 'all_materialized' } })
    expect(handoff!.planningTargetIds).toEqual([TARGET.a, TARGET.b])
    expect(handoff!.materializationOrder).toEqual(record.candidate.materializationOrder)
    expect(handoff!.materializedEntries.map(row => ({ orderIndex: row.orderIndex, entryId: row.entry.id, entrySemanticHash: hashStableValue(row.entry) })))
      .toEqual(record.targets.map(target => ({ orderIndex: target.orderIndex, entryId: (target.outcome as { entryId: string }).entryId, entrySemanticHash: (target.outcome as { entrySemanticHash: string }).entrySemanticHash })))
    // Structured clones: editing the handoff never reaches the run.
    handoff!.materializedEntries[0]!.entry.targetDefinitionHash = 'fnv1a32:00000000'
    expect(materializedEntriesFingerprintOfSemantic(on.result.semantic)).toBe(materializedEntriesFingerprintOfSemantic(off.semantic))
  }, 60_000)

  it('computes the Entry fingerprint exactly as the D-0C public RESULT does', async () => {
    const sources = await d0cFixtureSources()
    expect(deriveD0cPublicResult(sources).materializedEntries.fingerprint).toBe(materializedEntriesFingerprintOfSemantic(sources.records[0]!.record.semantic))
    const { result, handoffs } = await materializationRun(V1_GOLDEN_RUNNER_SPECS.held_crossing, d0cFixtureConditions())
    expect(materializedEntriesFingerprintOfHandoffs(handoffs)).toBe(deriveD0cPublicResult(sources).materializedEntries.fingerprint)
    expect(materializedEntriesFingerprintOfSemantic(result.semantic)).toBe(deriveD0cPublicResult(sources).materializedEntries.fingerprint)
  }, 60_000)
})

describe('Phase D-1A: the D-0C identity of a re-run materialization', () => {
  it('matches only the same semantic SHA-256, the same Entry fingerprint and the same handed-over Entries', async () => {
    const { result, handoffs } = await materializationRun(SHAPE_SPEC, SHAPE_CONDITIONS)
    const semanticSha256 = textHash(result.semantic)
    const fingerprint = materializedEntriesFingerprintOfSemantic(result.semantic)!
    const expected = { semanticSha256, entryFingerprint: fingerprint }
    expect(compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected })).toMatchObject({
      matched: true, issues: [], semanticSha256: { matched: true }, entryFingerprint: { fromSemanticRecord: fingerprint, fromHandoff: fingerprint, matched: true, handoffMatchesRecord: true }, candidates: 1, handoffs: 1,
    })
    const refused = (input: Parameters<typeof compareD0cMaterializationIdentity>[0], reason: RegExp) => {
      const comparison = compareD0cMaterializationIdentity(input)
      expect(comparison.matched).toBe(false)
      expect(comparison.issues.join(' ')).toMatch(reason)
    }
    refused({ semantic: result.semantic, semanticSha256, handoffs, expected: { ...expected, semanticSha256: 'f'.repeat(64) } }, /semantic SHA-256 .* is not the D-0C/)
    refused({ semantic: result.semantic, semanticSha256, handoffs, expected: { ...expected, entryFingerprint: 'fnv1a32:00000000' } }, /Entry fingerprint .* is not the D-0C/)
    const edited = structuredClone(handoffs)
    edited[0]!.materializedEntries[0]!.entry.targetDefinitionHash = 'fnv1a32:00000000'
    refused({ semantic: result.semantic, semanticSha256, handoffs: edited, expected }, /handed-over Entry bodies .* are not the Entries the semantic record identifies/)
    refused({ semantic: result.semantic, semanticSha256, handoffs: [], expected }, /0 handoffs for 1 materialized candidates/)
    refused({ semantic: { ...result.semantic, integrityIssues: ['x'] }, semanticSha256, handoffs, expected }, /1 integrity issues/)
  }, 60_000)
})

describe('Phase D-1A: the Entry set of the fresh process', () => {
  it('round-trips through JSON, refuses another source or edited Entries, and takes the fresh process\'s own Phase 0', async () => {
    const { scene, handoffs } = await materializationRun(SHAPE_SPEC, SHAPE_CONDITIONS)
    const provenance = { repositoryHeadSha: 'a'.repeat(40), export: { fileName: 'fixture.json', bytes: 10, sha256: 'e'.repeat(64) }, calculationContext: scene.input.calculationContext, rngEngineVersion: scene.engine.version }
    const set = createD1aEntrySet(handoffs[0]!, provenance)
    expect(set).toMatchObject({ kind: D1A_ENTRY_SET_KIND, protocolVersion: 'global-assignment-d1a:1', entryFingerprint: materializedEntriesFingerprintOfHandoffs(handoffs) })
    const read = JSON.parse(JSON.stringify(set))
    const expected = { ...provenance, entryFingerprint: set.entryFingerprint }
    expect(d1aEntrySetIssues(read, expected)).toEqual([])
    const issuesOf = (value: unknown, override: Partial<typeof expected> = {}) => d1aEntrySetIssues(value, { ...expected, ...override }).join(' ')
    expect(issuesOf({ ...read, kind: 'other' })).toMatch(/kind other is not/)
    expect(issuesOf(read, { repositoryHeadSha: 'b'.repeat(40) })).toMatch(/written at HEAD a{40}, not b{40}/)
    expect(issuesOf(read, { export: { ...provenance.export, sha256: 'f'.repeat(64) } })).toMatch(/another Export/)
    expect(issuesOf(read, { calculationContext: { ...provenance.calculationContext, appSchemaVersion: 1 } })).toMatch(/another CalculationContext/)
    expect(issuesOf(read, { rngEngineVersion: 'other' })).toMatch(/materialized with Engine/)
    expect(issuesOf(read, { entryFingerprint: 'fnv1a32:00000000' })).toMatch(/not the expected fnv1a32:00000000/)
    const tampered = structuredClone(read)
    tampered.materializedEntries[0].entry.targetDefinitionHash = 'fnv1a32:00000000'
    expect(issuesOf(tampered)).toMatch(/not the recorded/)
    expect(issuesOf({ ...read, materializedEntries: [{ orderIndex: 0 }] })).toMatch(/malformed/)
    expect(d1aEntrySetIssues(null, expected)).toEqual(['The Entry set is not an object.'])
    const fresh = handoffFromEntrySet(read, [TARGET.b, TARGET.a])
    expect(fresh.planningTargetIds).toEqual([TARGET.b, TARGET.a])
    expect(fresh.materializedEntries).toEqual(handoffs[0]!.materializedEntries)
    expect({ ...fresh, planningTargetIds: handoffs[0]!.planningTargetIds }).toEqual(handoffs[0])
  }, 60_000)
})

describe('Phase D-1A: a whole run without child processes', () => {
  it('ends verified: materialization -> identity -> Phase D\' -> Entry set -> fresh Phase 0 and Phase D\' -> judgement', async () => {
    const { scene, result, handoffs } = await materializationRun(SHAPE_SPEC, SHAPE_CONDITIONS)
    const semanticSha256 = textHash(result.semantic)
    const identity = compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected: { semanticSha256, entryFingerprint: materializedEntriesFingerprintOfSemantic(result.semantic)! } })
    expect(identity.matched).toBe(true)
    const first = await verifyPlannerCandidate(scene.input, handoffs[0]!, globalResearchDependencies(scene.engine), TEST_CONDITIONS, execution())
    expect(first.semantic.outcome).toEqual({ kind: 'conditions_met' })
    const set = JSON.parse(JSON.stringify(createD1aEntrySet(handoffs[0]!, { repositoryHeadSha: 'a'.repeat(40), export: { fileName: 'x.json', bytes: 1, sha256: 'e'.repeat(64) }, calculationContext: scene.input.calculationContext, rngEngineVersion: scene.engine.version })))
    // The fresh side rebuilds everything from the input: its own Phase 0, a fresh scene Engine and fresh Planner dependencies.
    const freshScene = await materializationScenario(SHAPE_SPEC)
    const context = createGlobalAssignmentContext(freshScene.input, globalResearchDependencies(freshScene.engine))
    if (context.kind !== 'context') throw new Error(context.detail)
    const freshPhase0 = context.context.planningTargets.map(target => target.id)
    const fresh = await verifyPlannerCandidate(freshScene.input, handoffFromEntrySet(set, freshPhase0), globalResearchDependencies(freshScene.engine), TEST_CONDITIONS, execution())
    const judgement = judgeD1aRun(
      { process: 'completed', identity, verification: view(first.semantic) },
      { process: 'completed', phase0PlanningTargetIds: [...freshPhase0].sort(), verification: view(fresh.semantic) },
    )
    expect(judgement.crossProcess).toEqual({ compared: true, identical: true, differingFields: [] })
    expect(judgement.recordClassification).toBe('nonformal_planner_verified')
    expect(judgement.verdict).toEqual({
      kind: 'verified', physicalOperations: handoffs[0]!.objective, planSteps: handoffs[0]!.objective, objective: handoffs[0]!.objective, planningTargetCount: 2, fullPlannerRuns: { first: 1, fresh: 1 },
    })
    expect(d1aOperationCountReading(judgement.verdict)).toEqual({ evaluated: true, physicalOperations: handoffs[0]!.objective, incumbent: D1A_INCUMBENT_PHYSICAL_OPERATIONS, judgement: 'improvement', proof: 'not_claimed' })
  }, 60_000)
})

function view(semantic: PlannerVerificationSemantic): D1aVerificationView {
  return { semantic, semanticSha256: textHash(semantic) }
}

describe('Phase D-1A: the judgement of one run (design 9.5 condition 13, 9.6)', () => {
  async function semantics() {
    const { scene, result, handoffs } = await materializationRun(SHAPE_SPEC, SHAPE_CONDITIONS)
    const semanticSha256 = textHash(result.semantic)
    const identity = compareD0cMaterializationIdentity({ semantic: result.semantic, semanticSha256, handoffs, expected: { semanticSha256, entryFingerprint: materializedEntriesFingerprintOfSemantic(result.semantic)! } })
    const met = (await verifyPlannerCandidate(scene.input, handoffs[0]!, globalResearchDependencies(scene.engine), TEST_CONDITIONS, execution())).semantic
    const truncated = (await verifyPlannerCandidate(scene.input, handoffs[0]!, globalResearchDependencies(scene.engine), { researchMaxPlanSteps: 1 }, execution())).semantic
    const otherBound = (await verifyPlannerCandidate(scene.input, handoffs[0]!, globalResearchDependencies(scene.engine), { researchMaxPlanSteps: TEST_CONDITIONS.researchMaxPlanSteps + 1 }, execution())).semantic
    return { identity, met, truncated, otherBound, phase0: [...handoffs[0]!.planningTargetIds].sort() }
  }

  it('is verified only when both processes meet every condition and agree; one side alone never is', async () => {
    const { identity, met, truncated, otherBound, phase0 } = await semantics()
    const first: D1aFirstProcessView = { process: 'completed', identity, verification: view(met) }
    const fresh: D1aFreshProcessView = { process: 'completed', phase0PlanningTargetIds: phase0, verification: view(met) }
    expect(judgeD1aRun(first, fresh).verdict.kind).toBe('verified')
    // The first process rejected: its outcome stands even though the fresh process met everything.
    const rejected = judgeD1aRun({ ...first, verification: view(truncated) }, fresh)
    expect(rejected.verdict).toMatchObject({ kind: 'planner_rejected', run: 'first' })
    expect(rejected.recordClassification).toBe('nonformal_planner_rejected')
    expect(rejected.crossProcess.identical).toBe(false)
    // The fresh process rejected.
    expect(judgeD1aRun(first, { ...fresh, verification: view(truncated) }).verdict).toMatchObject({ kind: 'planner_rejected', run: 'fresh' })
    // Both met, but the fresh process's semantic record differs: condition 13 fails.
    const mismatch = judgeD1aRun(first, { ...fresh, verification: view(otherBound) })
    expect(mismatch.verdict).toEqual({ kind: 'planner_rejected', run: 'cross_process', reasons: [{ code: 'fresh_planner_mismatch', differingFields: differingSemanticFields(met, otherBound) }] })
    expect(differingSemanticFields(met, otherBound)).toEqual(expect.arrayContaining(['conditions', 'finalInput', 'planner']))
    // The fresh process's own Phase 0 must be the first one's.
    expect(judgeD1aRun(first, { ...fresh, phase0PlanningTargetIds: [TARGET.a] }).verdict).toEqual({ kind: 'planning_target_set_changed', run: 'fresh', reasons: [{ code: 'planning_target_removed', targetWeaponIds: [TARGET.b] }] })
    expect(judgeD1aRun(first, { ...fresh, phase0PlanningTargetIds: [...phase0, 'target.fixture.z'] }).verdict).toEqual({ kind: 'planning_target_set_changed', run: 'fresh', reasons: [{ code: 'planning_target_added', targetWeaponIds: ['target.fixture.z'] }] })
  }, 60_000)

  it('reads a stopped process as unmeasured and an identity mismatch as a stop before Phase D\', never as a Planner result', async () => {
    const { identity, met, phase0 } = await semantics()
    const first: D1aFirstProcessView = { process: 'completed', identity, verification: view(met) }
    const fresh: D1aFreshProcessView = { process: 'completed', phase0PlanningTargetIds: phase0, verification: view(met) }
    for (const reason of ['timeout', 'out_of_memory', 'process_failure', 'cancelled'] as const) {
      expect(judgeD1aRun({ process: reason, identity: null, verification: null }, { process: 'not_run', phase0PlanningTargetIds: null, verification: null }).verdict).toEqual({ kind: 'unmeasured', run: 'first', reason })
      expect(judgeD1aRun(first, { process: reason, phase0PlanningTargetIds: null, verification: null }).verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason })
    }
    expect(judgeD1aRun(first, { process: 'not_run', phase0PlanningTargetIds: null, verification: null }).verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled' })
    expect(judgeD1aRun({ ...first, identity: null }, fresh).verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'process_failure' })
    expect(judgeD1aRun({ ...first, verification: null }, fresh).verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'process_failure' })
    expect(judgeD1aRun(first, { ...fresh, verification: null }).verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'process_failure' })
    const stopped = judgeD1aRun({ process: 'completed', identity: { ...identity, matched: false, issues: ['x'] }, verification: null }, { process: 'not_run', phase0PlanningTargetIds: null, verification: null })
    expect(stopped).toMatchObject({ verdict: { kind: 'stopped_d0c_identity_mismatch', issues: ['x'] }, recordClassification: 'nonformal_stopped_d0c_identity_mismatch', crossProcess: { compared: false, identical: null } })
    // No operation count is evaluated without verified (43 / 43 not reached), and no minimality is ever claimed.
    for (const verdict of [stopped.verdict, judgeD1aRun(first, { ...fresh, process: 'timeout' }).verdict]) {
      expect(d1aOperationCountReading(verdict)).toEqual({ evaluated: false, physicalOperations: null, incumbent: D1A_INCUMBENT_PHYSICAL_OPERATIONS, judgement: 'not_evaluated', proof: 'not_claimed' })
    }
  }, 60_000)

  it('maps every in-process outcome of either side to its typed candidate outcome', async () => {
    const { identity, met, phase0 } = await semantics()
    const withOutcome = (outcome: PlannerVerificationSemantic['outcome']) => view({ ...met, outcome })
    const first = (outcome: PlannerVerificationSemantic['outcome']): D1aFirstProcessView => ({ process: 'completed', identity, verification: withOutcome(outcome) })
    const fresh: D1aFreshProcessView = { process: 'completed', phase0PlanningTargetIds: phase0, verification: view(met) }
    expect(judgeD1aRun(first({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcomeKind: 'unconfirmed', outcomeReason: 'x' }), fresh).verdict).toEqual({ kind: 'materialization_unconfirmed', run: 'first', targetWeaponId: TARGET.b, outcomeKind: 'unconfirmed', outcomeReason: 'x' })
    expect(judgeD1aRun(first({ kind: 'planning_target_set_changed', reasons: [{ code: 'planning_target_added', targetWeaponIds: ['t'] }] }), fresh).verdict).toMatchObject({ kind: 'planning_target_set_changed', run: 'first' })
    expect(judgeD1aRun(first({ kind: 'objective_mismatch', physicalOperations: 5, objective: 6, reasons: [] }), fresh).verdict).toEqual({ kind: 'objective_mismatch', run: 'first', physicalOperations: 5, objective: 6, reasons: [] })
    expect(judgeD1aRun(first({ kind: 'unmeasured', reason: 'cancelled' }), fresh).verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled' })
    const freshObjective: D1aFreshProcessView = { ...fresh, verification: withOutcome({ kind: 'objective_mismatch', physicalOperations: 5, objective: 6, reasons: [] }) }
    expect(judgeD1aRun({ process: 'completed', identity, verification: view(met) }, freshObjective).verdict).toMatchObject({ kind: 'objective_mismatch', run: 'fresh' })
  }, 60_000)
})

describe('Phase D-1A: non-formal conditions and the child journal', () => {
  it('records the non-formal conditions as unregistered and not oracle-informed, and validates an envelope override', () => {
    expect(D1A_NONFORMAL_CONDITIONS.researchMaxPlanSteps.value).toBe(20_000)
    for (const condition of Object.values(D1A_NONFORMAL_CONDITIONS)) expect(condition).toMatchObject({ registered: false, oracleInformed: false })
    expect(d1aEnvelopeIssues({ firstChildWallMs: D1A_NONFORMAL_CONDITIONS.firstChildWallMs.value, freshChildWallMs: D1A_NONFORMAL_CONDITIONS.freshChildWallMs.value, childHeapMb: D1A_NONFORMAL_CONDITIONS.childHeapMb.value })).toEqual([])
    expect(d1aEnvelopeIssues({ firstChildWallMs: 10, freshChildWallMs: 1.5, childHeapMb: 0 })).toEqual([
      'firstChildWallMs must be an integer in 1000..86400000 (got 10).', 'freshChildWallMs must be an integer in 1000..86400000 (got 1.5).', 'childHeapMb must be an integer in 256..65536 (got 0).',
    ])
  })

  it('reads only confirmed facts from a journal: the materialization progress, the identity, the Entry set and the stage in progress', () => {
    const lines = [
      { kind: 'started', atMs: 0, pid: 1 },
      { kind: 'progress', atMs: 1, event: { kind: 'context', status: 'context', planningTargetCount: 2, reason: null } },
      { kind: 'memory', atMs: 2, heapUsed: 10, heapTotal: 20, rss: 30, external: 1 },
      { kind: 'identity', atMs: 3, matched: true },
      { kind: 'entry_set', atMs: 4 },
      { kind: 'verification_stage', atMs: 5, stage: 'handoff', status: 'started' },
      { kind: 'verification_stage', atMs: 6, stage: 'handoff', status: 'finished' },
      { kind: 'verification_stage', atMs: 7, stage: 'planner', status: 'started' },
    ].map(line => JSON.stringify(line))
    const progress = parseD1aJournal(`${lines.join('\n')}\n{"kind":"verification_st`)
    expect(progress).toMatchObject({ lines: 9, malformedLines: 1, started: true, finished: false, lastAtMs: 7, identity: { matched: true, atMs: 3 }, entrySetWritten: { atMs: 4 }, stageInProgress: 'planner' })
    expect(progress.stages.map(stage => `${stage.stage}:${stage.status}`)).toEqual(['handoff:started', 'handoff:finished', 'planner:started'])
    expect(progress.materialization).toMatchObject({ started: true, context: { planningTargetCount: 2 }, memory: { samples: 1, maxHeapUsed: 10 } })
    expect(parseD1aJournal('{"kind":"unknown","atMs":1}\n')).toMatchObject({ lines: 1, malformedLines: 1, started: false })
  })
})
