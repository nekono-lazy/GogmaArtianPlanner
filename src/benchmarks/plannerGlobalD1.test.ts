import { beforeEach, describe, expect, it, vi } from 'vitest'
import phaseBResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json?raw'
import phase2c2ResultRaw from '../../docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json?raw'
import phaseADocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md?raw'
import phaseBDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md?raw'
import followupDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md?raw'
import d1Document from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-d1.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-d1.mjs?raw'
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
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { PHASE2C26B2C1_POLICIES, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  phase2c27bResolveSupportContext,
  PHASE2C27B_INITIAL_LADDER_STATE,
  runPhase2C27BTrialLoop,
  type Phase2C27BTrialRecord,
  type Phase2C27BUnitTask,
} from './plannerGlobalPhase2C27B'
import mainSource from './plannerGlobalD1.ts?raw'
import analysisSource from './plannerGlobalD1Analysis.ts?raw'
import {
  checkD1RedeliveryContext,
  d1B0Parity,
  d1CompositionOutcome,
  d1CompositionProposal,
  d1InputDigest,
  d1ProductionChangedFiles,
  d1RedeliveryExpectation,
  d1RegisteredConditions,
  d1RegisteredEvaluations,
  d1ResultDigest,
  d1RuntimeUnsupportedRemoved,
  d1SParity,
  d1StartAttestationBody,
  D1_A_B_REGISTERED_TARGET_INDEXES,
  D1_BASE_MAIN,
  D1_CALCULATION_CONTEXT,
  D1_EVALUATION_FULL_RUN_CAP,
  D1_EXECUTION_ENVELOPE,
  D1_FOUND_UNITS,
  D1_PHASE_B_PROVENANCE,
  D1_REGISTERED_INPUTS,
  D1_RESEARCH_MAX_PLAN_STEPS,
  D1InvariantError,
  isD1BoundLimited,
  judgeD1R5,
  parseD1SpecTables,
  projectD1PhaseBResult,
  redeliverD1Candidate,
  runD1Evaluation,
  validateD1Inputs,
  verifyD1StartAttestation,
  type D1EvaluationChildResult,
  type D1EvaluationFacts,
  type D1EvaluationTask,
  type D1FoundTarget,
  type D1InputEvidence,
  type D1R5Input,
} from './plannerGlobalD1'
import { analyzeD1Run, classifyD1Decision, judgeD1R5Independently, type D1EvaluationRow, type D1RedeliveryRow } from './plannerGlobalD1Analysis'

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const codeOnly = (source: string) => source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')

// Captures every preflight call (the fixed constraints must always be []) and can force a refusal.
const preflightSpy = vi.hoisted(() => ({ calls: [] as { fixedConstraints: unknown[]; conflictResolutions: number; replacements: number }[], refuse: 0 }))
vi.mock('../domain/planner/replacement/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/planner/replacement/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>) => {
      preflightSpy.calls.push({ fixedConstraints: [...args[2]], conflictResolutions: args[0].conflictResolutions.length, replacements: args[1].length })
      if (preflightSpy.refuse > 0) {
        preflightSpy.refuse -= 1
        return { status: 'unresolved', conflictResolutions: [], failures: [] }
      }
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})
beforeEach(() => { preflightSpy.calls.length = 0; preflightSpy.refuse = 0 })

// ---------------------------------------------------------------- registered conditions

describe('D1 registered conditions (D1-A §1 / §2 / §6)', () => {
  it('registers the committed inputs by their SHA-256 (D1-A §1.2) and the Phase B provenance', async () => {
    expect(await sha256(phaseBResultRaw)).toBe(D1_REGISTERED_INPUTS.phaseBResult.sha256)
    expect(await sha256(phase2c2ResultRaw)).toBe(D1_REGISTERED_INPUTS.phase2c2Result.sha256)
    expect(await sha256(phaseADocument.replace(/\r\n/g, '\n'))).toBe(D1_REGISTERED_INPUTS.phaseADocument.sha256)
    expect(await sha256(phaseBDocument.replace(/\r\n/g, '\n'))).toBe(D1_REGISTERED_INPUTS.phaseBDocument.sha256)
    expect(await sha256(followupDocument.replace(/\r\n/g, '\n'))).toBe(D1_REGISTERED_INPUTS.followupDocument.sha256)
    expect(D1_PHASE_B_PROVENANCE.measuredHead).toBe('b24bf5dc7d98cb8341a24d27fabbd1a36843a004')
    expect(D1_BASE_MAIN).toMatch(/^[0-9a-f]{40}$/)
    // Every registered digest of the D1 document §1.2 / §1.3 is the source value.
    for (const registered of Object.values(D1_REGISTERED_INPUTS)) if (registered.sha256 !== null) expect(d1Document).toContain(registered.sha256)
    // The Export digest is reached through the Phase B attestation, never written in a Research source (Phase 2-A.5 isolation).
    expect(D1_REGISTERED_INPUTS.export.sha256).toBeNull()
    for (const unit of D1_FOUND_UNITS) for (const value of [unit.unitId, unit.recordSha256, unit.taskSha256]) expect(d1Document).toContain(value)
  })

  it('fixes the envelope, the Research Plan step bound, the full run cap and the CalculationContext', () => {
    expect(D1_EXECUTION_ENVELOPE).toEqual({ redeliveryBudgetMs: 3_600_000, evaluationBudgetMs: 1_800_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none',
      memorySampleIntervalMs: 250, nodeYield: 'setImmediate' })
    expect(D1_RESEARCH_MAX_PLAN_STEPS).toBe(20_000)
    expect(D1_EVALUATION_FULL_RUN_CAP).toBe(8)
    expect(D1_CALCULATION_CONTEXT).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(codeOnly(mainSource)).not.toMatch(/conflictResolutionPlannerOptions|defaultPlannerOptions|defaultPlannerAlternativeTrialBounds/)
  })

  it('parses the registered §1.3 tables of the D1 document: 11 found rows, 11 trial rows, A(b) = t01 / t07 / t08 / t09', () => {
    const { found, trials } = parseD1SpecTables(d1Document)
    expect(found.map(r => r.unitId)).toEqual(D1_FOUND_UNITS.map(u => u.unitId))
    expect(found.map(r => r.t)).toEqual(Array.from({ length: 11 }, (_, i) => `t${String(i).padStart(2, '0')}`))
    expect(found.filter(r => r.supportBuildListEntryIds.length > 0).map(r => r.t)).toEqual(['t09'])
    expect(found.every(r => r.deliveryIndex === 0 && r.routeOperationCount > 0 && r.routeKind.length > 0)).toBe(true)
    expect(trials.filter(r => r.generatedSelected).map(r => Number(r.t.slice(1)))).toEqual([...D1_A_B_REGISTERED_TARGET_INDEXES])
    expect(trials.every(r => r.fullRuns === 1 && r.termination === 'exhausted')).toBe(true)
    expect(trials.find(r => r.t === 't09')?.supportSelected).toEqual(found.find(r => r.t === 't09')?.supportBuildListEntryIds)
  })
})

// ---------------------------------------------------------------- the 80 registered evaluations (§2 / §5 / §6.4)

describe('D1 registered evaluations', () => {
  it('registers 80 evaluation requests in the fixed order, 68 of them R5 replacement sets', () => {
    const list = d1RegisteredEvaluations()
    expect(list).toHaveLength(80)
    expect(list.map(e => e.ordinal)).toEqual(Array.from({ length: 80 }, (_, i) => i))
    const count = (stage: string) => list.filter(e => e.stage === stage).length
    expect([count('B0'), count('S'), count('P'), count('A-a'), count('A-b'), count('A-c')]).toEqual([1, 11, 55, 1, 1, 11])
    expect(list.filter(e => e.evaluatedAgainst === 'replacement_set')).toHaveLength(68)
    expect(list[0]).toMatchObject({ evaluationId: 'B0', evaluatedAgainst: 'baseline_reference', targetIndexes: [] })
    expect(list.slice(1, 12).map(e => e.evaluationId)).toEqual(Array.from({ length: 11 }, (_, i) => `S-t${String(i).padStart(2, '0')}`))
    expect(list.slice(1, 12).every(e => e.evaluatedAgainst === 'baseline')).toBe(true)
    expect(list[12]!.evaluationId).toBe('P-t00-t01')
    expect(list[13]!.evaluationId).toBe('P-t00-t02')
    expect(list[66]!.evaluationId).toBe('P-t09-t10')
    expect(list.slice(12, 67).every((e, i, all) => i === 0 || e.evaluationId > all[i - 1]!.evaluationId)).toBe(true)
    expect(list[67]).toMatchObject({ evaluationId: 'A-a', targetIndexes: Array.from({ length: 11 }, (_, i) => i) })
    expect(list[68]).toMatchObject({ evaluationId: 'A-b', targetIndexes: [1, 7, 8, 9] })
    expect(list.slice(69).map(e => [e.evaluationId, e.candidateIndex, e.targetIndexes])).toEqual(Array.from({ length: 11 }, (_, k) => [`A-c-${String(k + 1).padStart(2, '0')}`, k, null]))
  })

  it('composes A(c) monotonically from the empty set, re-judging the whole proposed set and keeping the accepted set on an unmeasured step', () => {
    expect(d1CompositionProposal([], 0)).toEqual([0])
    expect(d1CompositionProposal([3, 1], 2)).toEqual([1, 2, 3])
    expect(d1CompositionOutcome([], 0, true, true)).toEqual({ proposed: [0], accepted: true, acceptedAfter: [0] })
    expect(d1CompositionOutcome([0], 1, true, false)).toEqual({ proposed: [0, 1], accepted: false, acceptedAfter: [0] })
    expect(d1CompositionOutcome([0], 2, false, null)).toEqual({ proposed: [0, 2], accepted: null, acceptedAfter: [0] })
    // A bound-limited or refused step is measured and not accepted.
    expect(d1CompositionOutcome([0], 3, true, null)).toEqual({ proposed: [0, 3], accepted: false, acceptedAfter: [0] })
  })
})

// ---------------------------------------------------------------- V: the Phase B RESULT allowlist and the input fail-closed (§1.2 / §9.1)

const fakeSha = (seed: string) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i) % 16]).join('')
const syncSha = (text: string) => fakeSha(`sha:${text}`)
const EXPORT_SHA = fakeSha('synthetic Export')

/** A complete synthetic V evidence that passes: the registered digests, 11 consistent records / tasks, a matching §1.3 table. */
function syntheticEvidence(): D1InputEvidence {
  const ids = Array.from({ length: 11 }, (_, i) => ({ target: `target.d1.${String(i).padStart(2, '0')}`, current: `entry.d1.o${i}`, generated: `entry.d1.g${i}`, key: `key.d1.${i}` }))
  const selected = new Set(D1_A_B_REGISTERED_TARGET_INDEXES)
  const files = Object.fromEntries(Object.entries(D1_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? EXPORT_SHA }])) as D1InputEvidence['files']
  const unitRecords: D1InputEvidence['unitRecords'] = {}, unitTasks: D1InputEvidence['unitTasks'] = {}
  const resultUnits: unknown[] = [], rawUnits: unknown[] = [], plans: unknown[] = []
  const foundRows: string[] = [], trialRows: string[] = []
  D1_FOUND_UNITS.forEach((unit, i) => {
    const support = i === 9 ? ['entry.d1.support'] : []
    const rung = unit.unitId.slice(-2), contextRank = Number(unit.unitId.slice(5, 7))
    const task = { unitId: unit.unitId, targetWeaponId: ids[i]!.target, targetIndex: i, contextRank, rung, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 },
      groupIndex: i, reservationDigest: `digest.${i}`, cardinality: support.length, representativeFixedSetId: `K${support.length}:x`, supportBuildListEntryIds: support,
      currentBuildListEntryId: ids[i]!.current, ladderStateAtStart: { ...PHASE2C27B_INITIAL_LADDER_STATE, previouslyRejectedCandidateStableKeys: [] }, budget: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 },
      researchMaxPlanSteps: 20_000 }
    const g = selected.has(i)
    const run = { planPresent: true, termination: { status: 'exhausted', completedTargetCount: 20, totalTargetCount: 43, reachedLimits: [] }, stepCount: 1465, selectedCount: 20, conflictCount: 21,
      warningKinds: [], generatedSelected: g, supportSelected: support, supportNotSelected: [], generatedConflictsWithSupport: false,
      generatedCommitment: g ? { status: 'secured', provisionalOutcomeSelectedBuildListEntryId: null, rejectionReasons: [] } : { status: 'dropped', provisionalOutcomeSelectedBuildListEntryId: 'entry.d1.winner', rejectionReasons: ['conflict_not_committed'] } }
    const trial = { trialOrdinal: 0, deliveryIndex: 0, candidateStableKey: ids[i]!.key, generatedBuildListEntryId: ids[i]!.generated, reusedExisting: false, preflight: 'ready', preflightRefusal: null,
      trialConflictResolutions: 0, fullRunsStarted: 1, run, verdict: { status: 'found_R', generatedSelected: g }, elapsedMs: 1 }
    const route = { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: null, operations: [{ type: 'reset_bonuses' }, { type: 'reset_skills' }] }
    const record = { role: 'unit', task, calculationContext: { ...D1_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000,
      result: { status: 'executed', unitId: unit.unitId, task, outcome: 'found_R', ladderStateAtStart: task.ladderStateAtStart, reservation: { r: i }, excludedRouteKeys: [`excluded.${i}`],
        deliveries: [{ deliveryIndex: 0, stableKey: ids[i]!.key, reservationCheck: { respects: true } }], trials: [trial],
        found: { candidateStableKey: ids[i]!.key, deliveryIndex: 0, trialOrdinal: 0, generatedBuildListEntryId: ids[i]!.generated, generatedSelected: g, route },
        search: { deliveredCandidates: 1, stoppedByConsumer: true } } }
    unitRecords[unit.unitId] = { file: { bytes: unit.recordBytes, sha256: unit.recordSha256 }, json: record }
    unitTasks[unit.unitId] = { file: { bytes: 10, sha256: unit.taskSha256 }, json: structuredClone(task) }
    resultUnits.push({ unitId: unit.unitId, result: 'found_R', deliveries: [{ i: 0, keySha256: syncSha(ids[i]!.key) }],
      trials: [{ ordinal: 0, delivery: 0, keySha256: syncSha(ids[i]!.key), preflight: 'ready', fullRuns: 1, verdict: trial.verdict, run: { planPresent: true, termination: 'exhausted', steps: 1465,
        selected: 20, conflicts: 21, generatedSelected: g, supportNotSelected: 0, generatedConflictsWithSupport: false, generatedCommitment: run.generatedCommitment.status } }],
      covering: 'oracle-derived', oracleKeySha256: 'ff' })
    resultUnits.push({ unitId: `${unit.unitId}-other`, result: 'not_found_within_search_extent' })
    rawUnits.push({ unitId: unit.unitId, targetWeaponId: task.targetWeaponId, targetIndex: i, contextRank, rung, ladderStateAtStart: task.ladderStateAtStart,
      recordFile: { file: `${unit.unitId}.record.json`, bytes: unit.recordBytes, sha256: unit.recordSha256 } })
    plans.push({ targetWeaponId: task.targetWeaponId, targetIndex: i, currentBuildListEntryId: task.currentBuildListEntryId, contexts: [{ contextRank, groupIndex: i, reservationDigest: task.reservationDigest,
      cardinality: support.length, representativeFixedSetId: task.representativeFixedSetId, supportBuildListEntryIds: support }] })
    const t = `t${String(i).padStart(2, '0')}`
    foundRows.push(`| ${t} | \`${task.targetWeaponId}\` | \`${unit.unitId}\` | rank | ${rung} | ${support.length ? `\`${support[0]}\`（Target x）` : 'なし'} | \`${task.reservationDigest}\` | \`${task.currentBuildListEntryId}\` | \`${ids[i]!.generated}\` | 0 | 2 / \`existing_gogma_mixed\` |`)
    trialRows.push(`| ${t} | true | exhausted | 20 | 1465 | 20 | 21 | ${g} | ${g ? 'secured' : 'dropped（`entry.d1.winner`）'} | ${support.length ? `\`${support[0]}\` selected` : '—'} | 1 |`)
  })
  const specMarkdown = ['# D1', `Export \`${EXPORT_SHA}\``, '| t | TargetWeapon ID | unit | context | rung / extent | support Entry | reservationDigest | `O_t` | `G_t` | delivery index | ops |', '| --- |', ...foundRows, '',
    '| t | plan | termination | completed / 43 | steps | selected | Conflict | `G` selected | commitment | support selected | full run |', '| --- |', ...trialRows, ''].join('\n')
  const unitRecordSources = D1_FOUND_UNITS.map(u => ({ file: `${u.unitId}.record.json`, bytes: u.recordBytes, sha256: u.recordSha256 }))
  return {
    files,
    phaseBResult: { sources: { unitRecords: unitRecordSources, export: { bytes: D1_REGISTERED_INPUTS.export.bytes, sha256: EXPORT_SHA }, oracle: { file: 'never' } }, provenance: { formal: true, measuredHead: D1_PHASE_B_PROVENANCE.measuredHead, runStatus: 'completed',
      benchmarkCodeSha256: D1_PHASE_B_PROVENANCE.benchmarkCodeSha256, calculationCodeChangedSinceMeasuredHead: [] }, decision: { case: 'B2C27B_INCOMPLETE' }, units: resultUnits,
      oracleMaterialization: { secret: true }, aggregates: { exactRecovered: 0 } },
    phaseBRaw: { status: 'completed', units: rawUnits, plans },
    phaseBAttestation: { policyAuthority: { sha256: D1_PHASE_B_PROVENANCE.policyAuthoritySha256 }, exportSha256: EXPORT_SHA,
      targetManifestSha256: D1_REGISTERED_INPUTS.phaseBTargets.sha256, researchMaxPlanSteps: 20_000 },
    phase2c2Result: { baseline: { summary: { planningTargetCount: 43, completedTargetCount: 20, termination: 'exhausted', planSteps: 1465, selectedTargets: [], conflicts: 21, conflictsByKind: {}, conflictSignatures: [] } } },
    unitRecords, unitTasks, specMarkdown,
  }
}

describe('D1 V: inputs and provenance fail closed (§1.2 / §1.3 / §9.1)', () => {
  it('reads only the allowlisted Phase B RESULT fields', () => {
    const projection = projectD1PhaseBResult(syntheticEvidence().phaseBResult)!
    const text = JSON.stringify(projection)
    expect(text).not.toMatch(/oracleMaterialization|exactRecovered|secret/)
    expect(Object.keys(projection.sources).sort()).toEqual(['attestation', 'export', 'run', 'runDir', 'targets', 'tasksRecord', 'unitRecords'])
    expect(projection.unitResults).toHaveLength(22)
    expect(projection.foundUnits).toHaveLength(11)
  })

  it('passes the consistent synthetic evidence and derives the 11 Targets mechanically', () => {
    const v = validateD1Inputs(syntheticEvidence(), syncSha)
    expect(v.issues).toEqual([])
    expect(v.passed).toBe(true)
    expect(v.targets.map(t => t.label)).toEqual(Array.from({ length: 11 }, (_, i) => `t${String(i).padStart(2, '0')}`))
    expect(v.targets[9]!.supportBuildListEntryIds).toEqual(['entry.d1.support'])
    expect(v.targets.filter(t => t.supportBuildListEntryIds.length === 0)).toHaveLength(10)
  })

  const failing = (mutate: (e: D1InputEvidence) => void) => {
    const e = syntheticEvidence()
    mutate(e)
    const v = validateD1Inputs(e, syncSha)
    expect(v.passed).toBe(false)
    expect(v.targets).toEqual([])
    return v.issues
  }

  it('fails closed on a missing file, a SHA-256 or byte mismatch, and never substitutes a value', () => {
    expect(failing(e => { e.files.phaseBRaw = null })).toContain(`phaseBRaw: ${D1_REGISTERED_INPUTS.phaseBRaw.file} is missing`)
    expect(failing(e => { e.files.export = { bytes: 19_424_064, sha256: '0'.repeat(64) } }).join(';')).toMatch(/export: SHA-256/)
    expect(failing(e => { (e.phaseBAttestation as { exportSha256: string }).exportSha256 = '1'.repeat(64) }).join(';')).toMatch(/the Phase B attestation Export is not the Export the D1 document registers/)
    expect(failing(e => { e.files.phaseBTasksRecord = { bytes: 1, sha256: D1_REGISTERED_INPUTS.phaseBTasksRecord.sha256 } }).join(';')).toMatch(/phaseBTasksRecord: 1 bytes/)
    expect(failing(e => { e.unitRecords['t03-r01-L2'] = null })).toContain('t03-r01-L2: the record or the task file is missing')
    expect(failing(e => { e.unitRecords['t04-r01-L2']!.file.sha256 = 'f'.repeat(64) }).join(';')).toMatch(/t04-r01-L2: the record is not the registered record/)
  })

  it('fails closed on record / task / raw / RESULT inconsistencies', () => {
    expect(failing(e => { ((e.unitTasks['t01-r01-L1']!.json) as Phase2C27BUnitTask).currentBuildListEntryId = 'entry.other' }).join(';')).toMatch(/record.task, record.result.task and the task file differ/)
    expect(failing(e => { ((e.phaseBRaw as { plans: { contexts: { reservationDigest: string }[] }[] }).plans[2]!.contexts[0]!.reservationDigest = 'other') }).join(';')).toMatch(/t02-r01-L2: the raw context reservationDigest differs/)
    expect(failing(e => { ((e.phaseBResult as { units: { result: string }[] }).units[0]!.result = 'not_found_within_search_extent') }).join(';')).toMatch(/found_R units/)
    expect(failing(e => { ((e.phaseBResult as { provenance: { formal: boolean } }).provenance.formal = false) })).toContain('Phase B RESULT provenance.formal is not true')
    expect(failing(e => { ((e.phaseBResult as { decision: { case: string } }).decision.case = 'B2C27B_E1_PARTIAL') })).toContain('Phase B RESULT decision.case is not B2C27B_INCOMPLETE')
    expect(failing(e => { ((e.unitRecords['t05-r01-L0']!.json as { result: { found: { candidateStableKey: string } } }).result.found.candidateStableKey = 'other') }).join(';')).toMatch(/t05-r01-L0/)
    expect(failing(e => { ((e.unitRecords['t06-r01-L0']!.json as { calculationContext: { appSchemaVersion: number } }).calculationContext.appSchemaVersion = 16) }).join(';')).toMatch(/CalculationContext/)
    expect(failing(e => { ((e.phaseBResult as { units: { trials?: { fullRuns: number }[] }[] }).units[0]!.trials![0]!.fullRuns = 2) }).join(';')).toMatch(/t00-r01-L1: the Phase B RESULT trial summary differs/)
    expect(failing(e => { e.phase2c2Result = { baseline: {} } })).toContain('the Phase 2-C2 RESULT has no baseline.summary')
  })

  it('fails closed when the derived values are not the registered §1.3 tables, or A(b) is not the registered set', () => {
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('`entry.d1.g3`', '`entry.d1.gX`') }).join(';')).toMatch(/t03-r01-L2: the derived values differ from the registered §1.3 table/)
    expect(failing(e => { e.specMarkdown = e.specMarkdown.replace('| t04 | true | exhausted | 20 | 1465', '| t04 | true | exhausted | 21 | 1465') }).join(';')).toMatch(/t04-r01-L2: the Phase B trial differs/)
    const issues = failing(e => {
      const record = e.unitRecords['t02-r01-L2']!.json as { result: { trials: { run: { generatedSelected: boolean } }[] } }
      record.result.trials[0]!.run.generatedSelected = true
    })
    expect(issues.join(';')).toMatch(/not the registered A\(b\) set/)
  })
})

// ---------------------------------------------------------------- R (Fake RNG Engine fixtures, the Phase B kernel fixture)

const TARGET_A = 'target.d1.a', TARGET_B = 'target.d1.b'
const ENTRY_A = 'build-list.d1.a' as BuildListEntryId, ENTRY_B = 'build-list.d1.b' as BuildListEntryId
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source'
const EXTENT = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }

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

/** A Phase B unit run for Target B with the given support set, and the D1 view of it. */
async function phaseBFound(support: string[]) {
  const built = fixture()
  const resolved = phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, support)
  if (resolved.status !== 'ready') throw new Error(resolved.issues.join('; '))
  const loop = await runPhase2C27BTrialLoop(built.input, resolved.prepared, EXTENT, PHASE2C27B_INITIAL_LADDER_STATE, built.dependencies)
  if (loop.outcome !== 'found_R' || loop.found === null) throw new Error(`fixture: ${loop.outcome}`)
  const task = { unitId: 't00-r01-L0', targetWeaponId: TARGET_B, targetIndex: 0, contextRank: 1, rung: 'L0', extent: EXTENT, groupIndex: 0, reservationDigest: hashStableValue(loop.reservation),
    cardinality: support.length, representativeFixedSetId: 'K', supportBuildListEntryIds: support, currentBuildListEntryId: ENTRY_B, ladderStateAtStart: PHASE2C27B_INITIAL_LADDER_STATE,
    budget: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 }, researchMaxPlanSteps: 20_000 } as unknown as Phase2C27BUnitTask
  const trial = loop.trials[loop.found.trialOrdinal] as Phase2C27BTrialRecord
  const target = { targetIndex: 0, label: 't00', unitId: task.unitId, targetWeaponId: TARGET_B, task, currentBuildListEntryId: ENTRY_B, generatedBuildListEntryId: loop.found.generatedBuildListEntryId,
    supportBuildListEntryIds: support, reservationDigest: task.reservationDigest, reservation: loop.reservation, excludedRouteKeys: loop.excludedRouteKeys, deliveryIndex: loop.found.deliveryIndex,
    trialOrdinal: loop.found.trialOrdinal, candidateStableKey: loop.found.candidateStableKey, trial: trial as never, found: loop.found as never, search: loop.search as never,
    deliveries: loop.deliveries.slice(0, loop.found.deliveryIndex + 1) as never, recordFile: { file: 'x', bytes: 1, sha256: 'x' }, taskFile: { file: 'x', bytes: 1, sha256: 'x' } } satisfies D1FoundTarget
  return { loop, task, target, prepared: resolved.prepared }
}

async function redeliver(target: D1FoundTarget, patch: (expectation: ReturnType<typeof d1RedeliveryExpectation>) => void = () => {}) {
  const built = fixture()
  const resolved = phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, target.supportBuildListEntryIds)
  if (resolved.status !== 'ready') throw new Error('fixture')
  const expectation = d1RedeliveryExpectation(target)
  patch(expectation)
  return { built, result: await redeliverD1Candidate(built.input, target.task, resolved.prepared, expectation, built.dependencies) }
}

describe('D1 R: faithful re-delivery (§3)', () => {
  it('re-delivers the Phase B Candidate up to the recorded delivery index and materializes the same G, with no trial', async () => {
    const { target, loop } = await phaseBFound([ENTRY_A])
    preflightSpy.calls.length = 0
    const { result } = await redeliver(target)
    expect(result.mismatches).toEqual([])
    expect(result.status).toBe('redelivered')
    expect(Object.values(result.matches).every(Boolean)).toBe(true)
    expect(result.generatedEntry?.id).toBe(loop.found!.generatedBuildListEntryId)
    expect(result.deliveredStableKeys).toEqual([loop.found!.candidateStableKey])
    expect(result.searchSummary).toMatchObject({ deliveredCandidates: 1, stoppedByConsumer: true })
    expect(preflightSpy.calls).toEqual([])
  })

  it('reports a mismatch for a different stable key, generated Entry ID, Route or delivery index, and writes no G', async () => {
    const { target } = await phaseBFound([ENTRY_A])
    const key = await redeliver(target, e => { e.deliveries[0]!.stableKey = 'other'; e.found.candidateStableKey = 'other' })
    expect(key.result.status).toBe('redelivery_mismatch')
    expect(key.result.generatedEntry).toBeNull()
    expect(key.result.matches.deliveryPrefix).toBe(false)
    expect(key.result.matches.candidateStableKey).toBe(false)
    const id = await redeliver(target, e => { e.found.generatedBuildListEntryId = 'build-list.other' })
    expect([id.result.status, id.result.matches.generatedBuildListEntryId, id.result.matches.searchIdentity]).toEqual(['redelivery_mismatch', false, false])
    const ops = await redeliver(target, e => { e.found.route = { ...(e.found.route as object), operations: [] } })
    expect([ops.result.status, ops.result.matches.routeOperations]).toEqual(['redelivery_mismatch', false])
    const respects = await redeliver(target, e => { e.deliveries[0]!.respects = !e.deliveries[0]!.respects })
    expect(respects.result.matches.deliveryPrefix).toBe(false)
    const late = await redeliver(target, e => { e.deliveryIndex = 40; e.deliveries = Array.from({ length: 41 }, () => ({ ...e.deliveries[0]! })) })
    expect([late.result.status, late.result.matches.deliveryPrefix, late.result.matches.searchSummary]).toEqual(['redelivery_mismatch', false, false])
  })

  it('checks the task context before any Search: a policy drift or an unknown Target is a mismatch', () => {
    const built = fixture()
    const schedule = { policies: PHASE2C26B2C1_POLICIES, extent: { ...defaultPlannerAlternativeSearchExtent }, snapshot: { fixedSets: [], reservationGroups: [], targets: [], originDigest: 'o' },
      targets: [], contexts: [], origins: { skill: 0, gogma: 0 }, checks: null } as unknown as Phase2C26B2C1Schedule
    const task = { unitId: 't00-r01-L0', targetWeaponId: TARGET_B, targetIndex: 0, contextRank: 1, rung: 'L0', extent: { ...defaultPlannerAlternativeSearchExtent }, groupIndex: 0,
      reservationDigest: 'x', cardinality: 0, representativeFixedSetId: 'K0', supportBuildListEntryIds: [], currentBuildListEntryId: ENTRY_B, ladderStateAtStart: PHASE2C27B_INITIAL_LADDER_STATE,
      budget: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 }, researchMaxPlanSteps: 20_000 } as unknown as Phase2C27BUnitTask
    const input = { ...built.input, options: { maxPlanSteps: 20_000 } }
    expect(checkD1RedeliveryContext(input, schedule, task, { reservation: null, excludedRouteKeys: [] }, built.dependencies).status).toBe('mismatch')
    const drifted = { ...schedule, extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 } } as Phase2C26B2C1Schedule
    const check = checkD1RedeliveryContext(input, drifted, task, { reservation: null, excludedRouteKeys: [] }, built.dependencies)
    expect(check.status === 'mismatch' && check.issues.join(';')).toMatch(/the schedule extent is not the Production default extent/)
  })
})

// ---------------------------------------------------------------- evaluation runs (§4 / §5)

const evaluationTask = (stage: D1EvaluationTask['stage'], targets: { target: D1FoundTarget; entry: BuildListEntry }[]): D1EvaluationTask => ({
  evaluationId: stage, stage, evaluatedAgainst: stage === 'B0' ? 'baseline_reference' : stage === 'S' ? 'baseline' : 'replacement_set',
  replacements: targets.map(({ target, entry }) => ({ targetIndex: target.targetIndex, targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId,
    generatedBuildListEntryId: entry.id, generatedEntrySha256: 'sha', requiresSupport: target.supportBuildListEntryIds, phaseBReservationDigest: target.reservationDigest, phaseBReservation: target.reservation })),
  researchMaxPlanSteps: 20_000, fullRunCap: 8 })
const research = (built: OrchestrationScenario) => ({ ...built.input, options: { maxPlanSteps: 20_000 } })
const facts = (result: D1EvaluationChildResult): D1EvaluationFacts => {
  if (result.status !== 'evaluated') throw new Error(`not evaluated: ${JSON.stringify(result).slice(0, 300)}`)
  return result
}

describe('D1 evaluations: B0 / S parity / replacement sets (§4.1 / §5)', () => {
  it('runs B0 as the persisted baseline with no preflight and a baseline summary', async () => {
    const built = fixture()
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, evaluationTask('B0', []), [], built.dependencies)
    const f = facts(result)
    expect(preflightSpy.calls).toEqual([])
    expect(f.preflight.status).toBe('not_run')
    expect(f.fullRunsStarted).toBe(1)
    expect(f.baselineSummary?.planningTargetCount).toBe(2)
    expect(f.resultDigest).toBe(d1ResultDigest(f))
    expect(d1B0Parity(f.baselineSummary, f.baselineSummary)).toEqual({ compared: expect.any(Array), matched: true, mismatches: [] })
    expect(d1B0Parity(f.baselineSummary, { ...f.baselineSummary, planSteps: 99_999 }).mismatches).toEqual(['planSteps'])
  })

  it('S reproduces the Phase B trial exactly (preflight, resolutions, full runs, run summary, verdict) with no fixed constraint (G1)', async () => {
    const { target } = await phaseBFound([ENTRY_A])
    const { built, result: r } = await redeliver(target)
    preflightSpy.calls.length = 0
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, evaluationTask('S', [{ target, entry: r.generatedEntry! }]), [r.generatedEntry!], built.dependencies)
    const f = facts(result)
    expect(preflightSpy.calls).toEqual([{ fixedConstraints: [], conflictResolutions: 0, replacements: 1 }])
    expect(f.runConflictResolutions).toBe(0)
    expect(d1SParity(f, target.trial)).toEqual({ compared: expect.any(Array), matched: true, mismatches: [] })
    expect(f.supportChecks[ENTRY_A]).toEqual({ S1: true, S2: true, S3: true, S4: true, S5: true })
    expect(d1SParity({ ...f, fullRunsStarted: 2 }, target.trial).mismatches).toEqual(['fullRunsStarted'])
    // R5 is never judged for S.
    expect(judgeD1R5({ status: 'evaluated', evaluatedAgainst: 'baseline', generatedBuildListEntryIds: [r.generatedEntry!.id], requiresSupport: [ENTRY_A], facts: f }).judged).toBe(false)
  })

  it('a replacement-set run replaces O by G through the 9.2.18 parts and records the §4.2 facts', async () => {
    const { target } = await phaseBFound([])
    const { built, result: r } = await redeliver(target)
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, { ...evaluationTask('P', [{ target, entry: r.generatedEntry! }]) }, [r.generatedEntry!], built.dependencies)
    const f = facts(result)
    expect(f.plan.present).toBe(true)
    expect(f.plan.selectedBuildListEntryIds).not.toContain(ENTRY_B)
    expect(f.routeCommitment.map(c => [c.buildListEntryId, c.role])).toEqual([[r.generatedEntry!.id, 'generated']])
    expect(f.conflicts.every(c => c.participants.every((id, i, all) => i === 0 || all[i - 1]! < id))).toBe(true)
    expect(f.steps.length).toBe(f.plan.steps)
    expect(Object.keys(f.supportChecks)).toEqual([])
  })

  it('records a preflight refusal as preflight_refused (measured), never as a calculation error', async () => {
    const { target } = await phaseBFound([])
    const { built, result: r } = await redeliver(target)
    preflightSpy.refuse = 1
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, evaluationTask('P', [{ target, entry: r.generatedEntry! }]), [r.generatedEntry!], built.dependencies)
    expect(result.status).toBe('preflight_refused')
    const f = result as D1EvaluationFacts & { status: 'preflight_refused' }
    expect(f.fullRunsStarted).toBe(0)
    const r5 = judgeD1R5({ status: 'preflight_refused', evaluatedAgainst: 'replacement_set', generatedBuildListEntryIds: [r.generatedEntry!.id], requiresSupport: [], facts: f })
    expect(r5).toMatchObject({ judged: true, satisfied: false, failureReasons: ['preflight_refused'], conditions: { planAndTraceReplayOk: false, allGeneratedSelected: null } })
  })

  it('fails as a guardrail violation (never a non-coexistence) on a foreign G body, a changed support body (S4) or a support that no longer derives the Phase B reservation (S5)', async () => {
    const { target } = await phaseBFound([ENTRY_A])
    const { built, result: r } = await redeliver(target)
    const g = r.generatedEntry!
    const foreign = await runD1Evaluation(research(built), built.input.buildListEntries, evaluationTask('S', [{ target, entry: g }]), [{ ...g, id: 'build-list.foreign' as BuildListEntryId }], built.dependencies)
    expect(foreign.status).toBe('guardrail_violation')
    const changedExport = built.input.buildListEntries.map(e => e.id === ENTRY_A ? { ...e, memo: 'changed' } : e)
    expect((await runD1Evaluation(research(built), changedExport, evaluationTask('S', [{ target, entry: g }]), [g], built.dependencies)).status).toBe('guardrail_violation')
    const s5 = evaluationTask('S', [{ target, entry: g }])
    s5.replacements[0]!.phaseBReservationDigest = 'fnv1a32:00000000'
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, s5, [g], built.dependencies)
    expect(result.status === 'guardrail_violation' && result.issues.join(';')).toMatch(/^S5/)
    expect(hashStableValue(derivePlannerAlternativeReservation([built.input.buildListEntries.find(e => e.id === ENTRY_A)!], built.dependencies.rngEngine))).toBe(target.reservationDigest)
  })

  it('records a thrown Plan generation failure as a calculation error (unmeasured), never as a measured outcome', async () => {
    const { target } = await phaseBFound([])
    const { built, result: r } = await redeliver(target)
    const throwing = { ...built.dependencies, clock: { now: () => { throw new Error('clock failure') } } }
    const result = await runD1Evaluation(research(built), built.input.buildListEntries, evaluationTask('P', [{ target, entry: r.generatedEntry! }]), [r.generatedEntry!], throwing)
    expect(result).toEqual({ status: 'calculation_error', error: { name: 'Error', message: 'clock failure' } })
  })

  it('derives the runtime-unsupported removals only from a consistent retry count, failing closed otherwise', () => {
    const built = fixture()
    const result = { plan: null, conflicts: [], warnings: [], termination: { status: 'exhausted', completedTargetCount: 0, totalTargetCount: 2, reachedLimits: [], limits: { maxPlanSteps: 1 }, expandedStates: 0 } }
    expect(d1RuntimeUnsupportedRemoved(built.input, { kind: 'persisted' }, result as never, 1, built.dependencies)).toEqual([])
    expect(() => d1RuntimeUnsupportedRemoved(built.input, { kind: 'persisted' }, result as never, 2, built.dependencies)).toThrow(D1InvariantError)
    const withWarning = { ...result, warnings: [{ kind: 'rng_prediction_unsupported', message: `BuildListEntry '${ENTRY_B}' requires unsupported RNG input (reset_bonuses: x).` }] }
    expect(d1RuntimeUnsupportedRemoved(built.input, { kind: 'persisted' }, withWarning as never, 2, built.dependencies)).toEqual([ENTRY_B])
  })

  it('writes no resolution, scenario resolution, lineage or selected Entry anywhere in its code (G1)', () => {
    expect(codeOnly(mainSource)).not.toMatch(/scenarioResolution|conflictRepairLineage|conflictResolutions: \[\{|PlannerConflictResolution\b|runPlannerAlternativeKernel|preparePlannerAlternativeKernel|mergePlannerConflictScenarioResolution/)
    expect(codeOnly(mainSource)).toMatch(/preparePlannerReplacementConflictPreflight\(augmented, replacements, \[\], contexts, dependencies\)/)
    expect(codeOnly(mainSource)).toMatch(/createPlannerAlternativeFullRunner\(budget, dependencies/)
  })
})

// ---------------------------------------------------------------- R5 (§4.4 / §4.5) and bound-limited (§6.2)

const r5Facts = (over: Partial<{ selected: string[]; conflicts: { participants: string[]; selectedBuildListEntryId?: string | null }[]; termination: string | null; present: boolean;
  supportChecks: Record<string, { S1: boolean; S2: boolean; S3: boolean; S4: boolean; S5: boolean }> }> = {}): D1R5Input['facts'] => ({
  plan: { present: over.present ?? true, termination: over.termination === null ? null : { status: over.termination ?? 'exhausted', completedTargetCount: 20, totalTargetCount: 43, reachedLimits: [] },
    steps: 10, selectedBuildListEntryIds: over.selected ?? ['g1', 'g2', 'sup', 'x'], warningKinds: [] },
  conflicts: (over.conflicts ?? []).map((c, i) => ({ id: `c${i}`, kind: 'same_gogma_counter', participants: c.participants, selectedBuildListEntryId: c.selectedBuildListEntryId ?? null,
    recommendedBuildListEntryId: null, resourceIdentity: null, resourceIdentityMatched: false })),
  supportChecks: over.supportChecks ?? { sup: { S1: true, S2: true, S3: true, S4: true, S5: true } },
})
const r5 = (over: Parameters<typeof r5Facts>[0] = {}, extra: Partial<D1R5Input> = {}) => {
  const input: D1R5Input = { status: 'evaluated', evaluatedAgainst: 'replacement_set', generatedBuildListEntryIds: ['g1', 'g2'], requiresSupport: ['sup'], facts: r5Facts(over), ...extra }
  const runner = judgeD1R5(input), independent = judgeD1R5Independently(input)
  expect(independent).toEqual(runner)
  return runner
}

describe('D1 R5 (set_coexistent_R) and the support dependency checks', () => {
  it('holds only when all five conditions hold, with both implementations agreeing', () => {
    expect(r5()).toMatchObject({ judged: true, satisfied: true, failureReasons: [], supportVacuous: false })
    expect(r5({}, { requiresSupport: [] })).toMatchObject({ satisfied: true, supportVacuous: true })
  })

  it('(1) every G selected, (2) every required support selected', () => {
    expect(r5({ selected: ['g1', 'sup'] })).toMatchObject({ satisfied: false, failureReasons: ['generated_not_selected:g2'], conditions: { allGeneratedSelected: false } })
    expect(r5({ selected: ['g1', 'g2'] })).toMatchObject({ satisfied: false, failureReasons: ['support_not_selected'], conditions: { allSupportSelected: false } })
  })

  it('(3) S1 - S3: a support whose Target is replaced, missing from the final input, or invalid there is support_expired_R', () => {
    for (const broken of ['S1', 'S2', 'S3'] as const) {
      const checks = { sup: { S1: true, S2: true, S3: true, S4: true, S5: true, [broken]: false } }
      expect(r5({ supportChecks: checks })).toMatchObject({ satisfied: false, failureReasons: ['support_expired_R'], conditions: { supportDependenciesValid: false } })
    }
    expect(r5({ supportChecks: {} })).toMatchObject({ satisfied: false, failureReasons: ['support_expired_R'] })
  })

  it('(4) counts a Conflict between two members of M whatever its selectedBuildListEntryId, and ignores one with a single member', () => {
    expect(r5({ conflicts: [{ participants: ['g1', 'x'] }, { participants: ['g2', 'y', 'z'] }] }).satisfied).toBe(true)
    expect(r5({ conflicts: [{ participants: ['g1', 'g2'], selectedBuildListEntryId: 'g1' }] })).toMatchObject({ satisfied: false, failureReasons: ['conflict_within_set'] })
    expect(r5({ conflicts: [{ participants: ['g1', 'sup', 'x'] }] })).toMatchObject({ satisfied: false, failureReasons: ['conflict_within_set'] })
  })

  it('(5) no Plan, an incomplete (bound-truncated) Plan, a refused preflight and the rerun bound are measured R5 failures; incomplete and rerun bound are bound-limited', () => {
    expect(r5({ present: false })).toMatchObject({ satisfied: false, failureReasons: ['no_plan'], conditions: { allGeneratedSelected: null, planAndTraceReplayOk: false } })
    expect(r5({ termination: 'incomplete' })).toMatchObject({ satisfied: false, failureReasons: ['plan_bound_truncated'], conditions: { allGeneratedSelected: true, planAndTraceReplayOk: false } })
    expect(r5({}, { status: 'planner_rerun_bound_reached' })).toMatchObject({ satisfied: false, failureReasons: ['planner_rerun_bound_reached'] })
    expect(isD1BoundLimited('evaluated', r5Facts({ termination: 'incomplete' }))).toBe(true)
    expect(isD1BoundLimited('planner_rerun_bound_reached', null)).toBe(true)
    expect(isD1BoundLimited('evaluated', r5Facts())).toBe(false)
    expect(isD1BoundLimited('timeout', null)).toBe(false)
  })

  it('never judges an unmeasured, not executed or calculation-error evaluation, nor a baseline one', () => {
    for (const status of ['timeout', 'out_of_memory', 'process_failure', 'interrupted', 'calculation_error', 'not_executed'] as const) {
      expect(r5({}, { status, facts: null })).toMatchObject({ judged: false, satisfied: null })
    }
    expect(r5({}, { evaluatedAgainst: 'baseline' })).toMatchObject({ judged: false })
  })
})

// ---------------------------------------------------------------- decision (§7) and the run analysis (§9)

describe('D1 decision order (§7)', () => {
  const base = { invalidReasons: [], unmeasuredOrNotExecuted: 0, aASatisfied: false, satisfiedSetsOfSizeAtLeast2: [], boundLimitedEvaluations: [] }
  it('classifies top to bottom', () => {
    expect(classifyD1Decision({ ...base, invalidReasons: [{ category: 'determinism', detail: 'x' }], unmeasuredOrNotExecuted: 3, aASatisfied: true }).case).toBe('D1_INVALID')
    const incomplete = classifyD1Decision({ ...base, unmeasuredOrNotExecuted: 1, aASatisfied: true })
    expect(incomplete).toMatchObject({ case: 'D1_INCOMPLETE', lowerBound: true, coexistsObservedUnderIncomplete: true })
    expect(classifyD1Decision({ ...base, aASatisfied: true }).case).toBe('D1_FOUND_R_SET_COEXISTS')
    expect(classifyD1Decision({ ...base, satisfiedSetsOfSizeAtLeast2: [{ evaluationId: 'P-t01-t07', stage: 'P', size: 2 }] }).case).toBe('D1_FOUND_R_SET_PARTIAL')
    const notObserved = classifyD1Decision({ ...base, boundLimitedEvaluations: ['P-t00-t01'] })
    expect(notObserved).toMatchObject({ case: 'D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED', boundLimitedEvaluations: ['P-t00-t01'] })
    expect(notObserved.reasons.join(' ')).toMatch(/not a proof of non-coexistence/)
  })
})

/** A synthetic run: 11 Targets, every R redelivered, every evaluation evaluated with facts from `factsOf`. */
function syntheticRun(factsOf: (indexes: number[], stage: string) => Partial<{ selected: string[]; conflicts: { participants: string[] }[]; termination: string }> | 'timeout' | 'calculation_error' | null = () => ({})) {
  const targets = Array.from({ length: 11 }, (_, i) => ({ targetIndex: i, label: `t${String(i).padStart(2, '0')}`, unitId: D1_FOUND_UNITS[i]!.unitId, targetWeaponId: `target.${String(i).padStart(2, '0')}`,
    currentBuildListEntryId: `o${i}`, generatedBuildListEntryId: `g${i}`, supportBuildListEntryIds: i === 9 ? ['sup'] : [], candidateStableKey: `k${i}`,
    trial: { preflight: 'ready', preflightRefusal: null, trialConflictResolutions: 0, fullRunsStarted: 1, run: null, verdict: null } })) as unknown as D1FoundTarget[]
  const gSha = (i: number) => `sha${i}`
  const redeliveryRows: D1RedeliveryRow[] = targets.map(t => ({ unitId: t.unitId, targetIndex: t.targetIndex, targetWeaponId: t.targetWeaponId, status: 'redelivered',
    process: { outcome: 'completed', wallMs: 1 }, recordFile: { file: 'r', bytes: 1, sha256: 'r' }, generatedEntry: { file: 'g', bytes: 1, sha256: gSha(t.targetIndex) }, notExecutedReason: null }))
  const redeliveryRecords = new Map(targets.map(t => [t.unitId, { calculationContext: { ...D1_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000,
    generatedEntryFile: { sha256: gSha(t.targetIndex) }, result: { status: 'redelivered', matches: Object.fromEntries(['deliveryPrefix', 'candidateStableKey', 'generatedBuildListEntryId', 'reusedExistingFalse',
      'routeOperations', 'candidateResult', 'searchIdentity', 'searchSummary', 'replacement', 'reservation', 'excludedRouteKeys', 'originDigest'].map(k => [k, true])), mismatches: [] } }]))
  const generatedEntries = new Map(targets.map(t => [t.unitId, { bytes: 1, sha256: gSha(t.targetIndex), body: { id: t.generatedBuildListEntryId, targetWeaponId: t.targetWeaponId,
    candidateSnapshot: { __key: t.candidateStableKey } } }]))
  const evaluationRows: D1EvaluationRow[] = []
  const evaluationRecords = new Map<string, Record<string, unknown> | null>()
  let accepted: number[] = []
  for (const reg of d1RegisteredEvaluations()) {
    const indexes = reg.stage === 'A-c' ? d1CompositionProposal(accepted, reg.candidateIndex!) : reg.targetIndexes!
    const ts = indexes.map(i => targets[i]!)
    const spec = factsOf(indexes, reg.stage)
    const status = spec === 'timeout' ? 'timeout' : spec === 'calculation_error' ? 'calculation_error' : 'evaluated'
    const over = typeof spec === 'object' && spec !== null ? spec : {}
    const generatedIds = ts.map(t => t.generatedBuildListEntryId)
    const selected = over.selected ?? (reg.stage === 'B0' ? targets.map(t => t.currentBuildListEntryId) : [...generatedIds, 'sup'])
    const f = { preflight: { status: reg.stage === 'B0' ? 'not_run' : 'ready', refusal: null }, runConflictResolutions: 0, fullRunsStarted: 1, runtimeUnsupportedRemoved: [],
      plan: { present: true, termination: { status: over.termination ?? 'exhausted', completedTargetCount: 20, totalTargetCount: 43, reachedLimits: [] }, steps: 100, selectedBuildListEntryIds: [...selected].sort(), warningKinds: [] },
      conflicts: (over.conflicts ?? []).map((c, i) => ({ id: `c${i}`, kind: 'same_gogma_counter', participants: [...c.participants].sort(), selectedBuildListEntryId: null, recommendedBuildListEntryId: null, resourceIdentity: null, resourceIdentityMatched: false })),
      routeCommitment: [], supportChecks: indexes.includes(9) ? { sup: { S1: true, S2: true, S3: true, S4: true, S5: true } } : {},
      trialRunSummary: null, trialVerdict: null, baselineSummary: reg.stage === 'B0' ? { planningTargetCount: 43 } : null, steps: [], resultDigest: '' } as unknown as D1EvaluationFacts
    f.resultDigest = d1ResultDigest(f)
    const support = [...new Set(ts.flatMap(t => t.supportBuildListEntryIds))]
    const runnerR5 = judgeD1R5({ status: status as never, evaluatedAgainst: reg.evaluatedAgainst, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts: status === 'evaluated' ? f : null })
    const composition = reg.stage === 'A-c' ? d1CompositionOutcome(accepted, reg.candidateIndex!, status === 'evaluated', runnerR5.satisfied) : null
    evaluationRows.push({ evaluationId: reg.evaluationId, stage: reg.stage, ordinal: reg.ordinal, evaluatedAgainst: reg.evaluatedAgainst, replacementTargetIndexes: indexes,
      replacementTargets: ts.map(t => t.targetWeaponId), generatedEntryIds: generatedIds, generatedEntrySha256s: indexes.map(gSha), requiresSupport: support,
      inputDigest: d1InputDigest(ts.map(t => t.targetWeaponId), generatedIds, indexes.map(gSha), 'export'), status, notExecutedReason: null,
      process: { outcome: status === 'timeout' ? 'timeout' : 'completed', wallMs: 1 }, recordFile: { file: 'e', bytes: 1, sha256: 'e' },
      runner: { r5: runnerR5, parity: null, boundLimited: false },
      composition: composition === null ? null : { acceptedBefore: [...accepted], candidate: reg.candidateIndex!, ...composition }, afterUnmeasuredStep: false })
    evaluationRecords.set(reg.evaluationId, status === 'timeout' ? null : { calculationContext: { ...D1_CALCULATION_CONTEXT }, rngEngineVersion: 'production-rng:c5-e7', researchMaxPlanSteps: 20_000,
      result: status === 'calculation_error' ? { status, error: { name: 'Error', message: 'x' } } : { status, ...f } })
    if (composition !== null) accepted = composition.acceptedAfter
  }
  const unmeasuredFrom = evaluationRows.findIndex(r => r.stage === 'A-c' && r.status !== 'evaluated')
  if (unmeasuredFrom >= 0) evaluationRows.slice(unmeasuredFrom + 1).forEach(r => { if (r.stage === 'A-c') r.afterUnmeasuredStep = true })
  return { targets, inputValidation: { passed: true, issues: [] }, phase2c2BaselineSummary: { planningTargetCount: 43 }, exportSha256: 'export', redeliveryRows, redeliveryRecords, generatedEntries,
    evaluationRows, evaluationRecords, interrupted: false, provenanceIssues: [], rawConsistencyIssues: [], childProcessCount: 91 }
}

// The synthetic G store body stands for a BuildListEntry whose stable key is its `__key`.
vi.mock('../domain/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search')>()
  return { ...actual, candidateStableKey: (candidate: { __key?: string }) => candidate.__key ?? actual.candidateStableKey(candidate as never) }
})

describe('D1 run analysis (§6.4 / §7 / §9)', () => {
  const analyze = (run: ReturnType<typeof syntheticRun>) => {
    const result = analyzeD1Run(run as never)
    return result
  }
  // B0 and S parity are checked against the synthetic references.
  const parityFree = (run: ReturnType<typeof syntheticRun>) => {
    run.evaluationRows.forEach(r => { if (r.stage === 'S') r.runner = r.runner && { ...r.runner } })
    return run
  }

  it('classifies a run whose pairs coexist but whose full set does not as PARTIAL, with A(c) replayed', () => {
    // G1 and G2 collide only when both are in the set together with any third Target.
    const run = parityFree(syntheticRun((indexes) => indexes.length >= 3 ? { conflicts: [{ participants: [`g${indexes[0]}`, `g${indexes[1]}`] }] } : {}))
    const result = analyze(run)
    const s = result.evaluations.filter(e => e.stage === 'S')
    expect(s.every(e => e.parity !== null)).toBe(true)
    const nonParity = result.invalidReasons.filter(r => r.category !== 'phase_b_parity_mismatch')
    expect(nonParity).toEqual([])
    expect(result.evaluations.find(e => e.evaluationId === 'A-a')!.r5.satisfied).toBe(false)
    expect(result.aggregates.r5.satisfiedSetsOfSizeAtLeast2.filter(x => x.stage === 'P')).toHaveLength(55)
    expect(result.aggregates.aCFinalAccepted).toEqual([0, 1])
    expect(result.aggregates.r5.maxObservedSatisfiedSetSize).toBe(2)
  })

  it('reads a timeout as unmeasured (INCOMPLETE, never non-coexistence), keeps A(c) composing with accepted = null and flags the later steps', () => {
    const run = syntheticRun((indexes, stage) => stage === 'A-c' && indexes.includes(3) && indexes.length === 1 ? 'timeout' : stage === 'P' && indexes[0] === 0 && indexes[1] === 1 ? 'calculation_error' : {})
    const result = analyze(run)
    const invalid = result.invalidReasons.filter(r => r.category !== 'phase_b_parity_mismatch' && r.category !== 'baseline_parity_mismatch')
    expect(invalid).toEqual([])
    const p = result.evaluations.find(e => e.evaluationId === 'P-t00-t01')!
    expect([p.status, p.unmeasuredReason, p.r5.judged]).toEqual(['calculation_error', 'calculation_error', false])
    expect(result.aggregates.evaluations.unmeasuredByReason).toEqual({ calculation_error: 1 })
  })

  it('detects a determinism break between evaluations of one inputDigest, an A(c) replay mismatch and a runner R5 that differs', () => {
    const run = syntheticRun()
    const s = run.evaluationRecords.get('S-t00') as { result: D1EvaluationFacts }
    s.result.resultDigest = d1ResultDigest({ ...s.result, steps: [{ order: 1, operationType: 'reset_bonuses', targetWeaponId: null, buildListEntryId: null, progressedTargetWeaponIds: null, rngAdvance: null }] })
    s.result.steps = [{ order: 1, operationType: 'reset_bonuses', targetWeaponId: null, buildListEntryId: null, progressedTargetWeaponIds: null, rngAdvance: null }]
    const ac = run.evaluationRows.find(r => r.evaluationId === 'A-c-05')!
    ac.composition = { ...ac.composition!, accepted: false }
    const p = run.evaluationRows.find(r => r.evaluationId === 'P-t02-t03')!
    p.runner = { ...p.runner!, r5: { ...p.runner!.r5, satisfied: false } }
    const result = analyze(run)
    const categories = result.invalidReasons.map(r => `${r.category}: ${r.detail}`)
    expect(categories.some(c => c.startsWith('determinism') && c.includes('S-t00') && c.includes('A-c-01'))).toBe(true)
    expect(categories).toContain('raw_result_mismatch: A-c-05: the recorded A(c) step is not the replayed one')
    expect(categories).toContain('raw_result_mismatch: P-t02-t03: the runner R5 differs from the analyzer R5')
    expect(result.decision.case).toBe('D1_INVALID')
  })

  it('treats a G1 violation, a registry order violation and a redelivery mismatch as INVALID', () => {
    const run = syntheticRun()
    const rec = run.evaluationRecords.get('P-t04-t05') as { result: { runConflictResolutions: number } }
    rec.result.runConflictResolutions = 1
    ;[run.evaluationRows[20], run.evaluationRows[21]] = [run.evaluationRows[21]!, run.evaluationRows[20]!]
    const r = run.redeliveryRecords.get('t03-r01-L2') as { result: { matches: Record<string, boolean> } }
    r.result.matches.routeOperations = false
    const result = analyze(run)
    const categories = new Set(result.invalidReasons.map(x => x.category))
    expect(categories.has('guardrail')).toBe(true)
    expect(categories.has('redelivery_mismatch')).toBe(true)
    expect(result.decision.case).toBe('D1_INVALID')
  })

  it('computes target_regressed_R from B0 (O_t selected there, G_t not selected here) and the baseline diff', () => {
    const run = syntheticRun((indexes, stage) => stage === 'P' && indexes[0] === 0 && indexes[1] === 1 ? { selected: ['g0', 'o2'] } : {})
    const p = analyze(run).evaluations.find(e => e.evaluationId === 'P-t00-t01')!
    expect(p.candidates.map(c => c.targetRegressedR)).toEqual([false, true])
    expect(p.baselineDiff).toMatchObject({ selectedAdded: ['g0'], completedDelta: 0 })
  })
})

// ---------------------------------------------------------------- oracle isolation and the sources (§9.3)

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

describe('D1 oracle isolation and sources (§9.3 / G19 - G22)', () => {
  it('reaches no oracle, Phase B analysis or population-authority module from the runner, child or analyzer modules', () => {
    for (const entry of ['./plannerGlobalD1.ts', './plannerGlobalD1Analysis.ts']) {
      const closure = benchmarkClosure(entry)
      expect(closure).toContain('./plannerGlobalPhase2C27B.ts')
      expect(closure.filter(f => /Oracle|Phase2C27BAnalysis|Phase2C27BTargets|Interpretation|FormalValidation|LowerBound/.test(f))).toEqual([])
      // The D1 modules name the registered input files (D1-A §1.2); none of them, nor any other module of the closure, reads a file or the oracle.
      for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|Oracle1657|_1657_ORACLE|readFile|node:fs/)
      for (const file of closure.filter(f => !/plannerGlobalD1/.test(f))) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/_RESULT\.json/)
    }
    const loaded = (source: string) => [...source.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded(runnerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalOptimizationResearch.ts', '/src/benchmarks/plannerGlobalPhase2C26A.ts',
      '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(loaded(analyzerSource)).toEqual(['/src/benchmarks/plannerGlobalD1.ts', '/src/benchmarks/plannerGlobalD1Analysis.ts'])
    for (const source of [runnerSource, analyzerSource]) expect(codeOnly(source)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|--oracle|--manifest|Analysis\.ts'\)\.materialize/)
  })

  it('hard-codes no Target, Entry, reservation digest or stable key anywhere in the D1 code', () => {
    // The registered §1.3 values (Targets, current / generated / support Entries) come from the D1 document, never the Phase B RESULT.
    const rows = parseD1SpecTables(d1Document).found
    const e1 = rows.flatMap(r => [r.targetWeaponId, r.currentBuildListEntryId, r.generatedBuildListEntryId, ...r.supportBuildListEntryIds, r.reservationDigest])
    expect(e1).toHaveLength(45)
    for (const source of [mainSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|fnv1a32[-:][0-9a-f]{8}|build-list\./)
      for (const id of e1) expect(source).not.toContain(id.replace(/^build-list\.(constrained\.)?/, '').slice(0, 16))
    }
  })

  it('is never imported by Production', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalD1/.test(source)).map(([path]) => path)).toEqual([])
  })

  it('counts Production source changes by the registered research / test path rule', () => {
    expect(d1ProductionChangedFiles(['src/benchmarks/plannerGlobalD1.ts', 'scripts/run-planner-global-d1.mjs', 'docs/x.md', 'src/domain/x.test.ts'])).toEqual([])
    expect(d1ProductionChangedFiles(['src/domain/planner/x.ts', 'src/benchmarks/a.ts'])).toEqual(['src/domain/planner/x.ts'])
  })
})

// ---------------------------------------------------------------- start attestation and digests (§9.2 / §9.4)

const observation = () => ({ createdAt: '2026-10-10T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-d1.mjs', node: 'v24', repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64),
  observedInputs: Object.fromEntries(Object.entries(D1_REGISTERED_INPUTS).map(([k, v]) => [k, { bytes: v.bytes ?? 1, sha256: v.sha256 ?? 'e'.repeat(64) }])), exportFileName: D1_REGISTERED_INPUTS.export.file,
  productionAudit: { baseMain: D1_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 },
  appliedExecutionEnvelope: { ...D1_EXECUTION_ENVELOPE }, smoke: null })
const expectation = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), specDocumentSha256: 'c'.repeat(64), exportSha256: 'e'.repeat(64), firstChildStartedAt: '2026-10-10T00:00:01.000Z' }

describe('D1 start attestation and digests', () => {
  it('verifies a clean formal launch with every registered condition', () => {
    const body = JSON.parse(JSON.stringify(d1StartAttestationBody(observation())))
    expect(verifyD1StartAttestation(body, expectation)).toEqual({ verified: true, issues: [] })
    expect(d1RegisteredConditions().stages).toHaveLength(80)
    expect(d1RegisteredConditions().decisionRule).toHaveLength(5)
  })

  it('fails on Production changes, a smoke or uncommitted launch, a changed condition or input, a later attestation or another HEAD / document', () => {
    const verify = (patch: object, exp = expectation) => verifyD1StartAttestation(JSON.parse(JSON.stringify({ ...d1StartAttestationBody(observation()), ...patch })), exp)
    expect(verify({ productionAudit: { baseMain: D1_BASE_MAIN, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { redeliveryTargetIndexes: [1], maxEvaluations: null, budgetMs: null } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ appliedExecutionEnvelope: { ...D1_EXECUTION_ENVELOPE, evaluationBudgetMs: 60_000 } }).verified).toBe(false)
    expect(verify({ evaluationFullRunCap: 9 }).verified).toBe(false)
    expect(verify({ observedInputs: { ...observation().observedInputs, export: { bytes: 1, sha256: '0'.repeat(64) } } }).verified).toBe(false)
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-09T00:00:00.000Z' }).issues).toContain('createdAt is later than the first child start')
    expect(verify({}, { ...expectation, repositoryHead: 'f'.repeat(40) }).issues).toContain('repositoryHead differs')
    expect(verify({}, { ...expectation, specDocumentSha256: 'f'.repeat(64) }).issues).toContain('specDocumentSha256 differs')
    expect(verify({ extra: 1 }).issues).toContain('the start attestation keys are not exactly the attestation keys')
  })

  it('makes inputDigest depend on the set, the G bodies and the Export, and resultDigest on the semantic projection only', () => {
    const a = d1InputDigest(['t1', 't2'], ['g1', 'g2'], ['s1', 's2'], 'e')
    expect(d1InputDigest(['t1', 't2'], ['g1', 'g2'], ['s1', 's2'], 'e')).toBe(a)
    expect(d1InputDigest(['t1', 't2'], ['g1', 'g2'], ['s1', 'sX'], 'e')).not.toBe(a)
    expect(d1InputDigest(['t1', 't2'], ['g1', 'g2'], ['s1', 's2'], 'e2')).not.toBe(a)
    const f = r5Facts({ conflicts: [{ participants: ['b', 'a'] }, { participants: ['c', 'd'] }] })!
    const base = { plan: f.plan, conflicts: f.conflicts, steps: [], fullRunsStarted: 1, runtimeUnsupportedRemoved: [] }
    const digest = d1ResultDigest(base)
    expect(d1ResultDigest({ ...base, conflicts: [...base.conflicts].reverse(), plan: { ...base.plan, selectedBuildListEntryIds: [...base.plan.selectedBuildListEntryIds].reverse() } })).toBe(digest)
    expect(d1ResultDigest({ ...base, fullRunsStarted: 2 })).not.toBe(digest)
    expect(d1ResultDigest({ ...base, steps: [{ order: 1, operationType: 'x', targetWeaponId: null, buildListEntryId: null, progressedTargetWeaponIds: null, rngAdvance: null }] })).not.toBe(digest)
  })
})
