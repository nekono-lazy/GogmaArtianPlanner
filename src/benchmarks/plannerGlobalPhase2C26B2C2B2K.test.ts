import { describe, expect, it } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawB2C2B2I from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json?raw'
import rawB2C2B2J from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json?raw'
import { runPhase2C26B2C2B2DTask } from './plannerGlobalPhase2C26B2C2B2D'
import type { Phase2C26B2C2B2DBaselineRederivation, Phase2C26B2C2B2DContextComparison } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import { runPhase2C26B2C2B2ETask, PHASE2C26B2C2B2E_PROVENANCE_FLAGS, PHASE2C26B2C2B2E_STAGE1 } from './plannerGlobalPhase2C26B2C2B2E'
import { PHASE2C26B2C2B2I_OPTIMIZATION } from './plannerGlobalPhase2C26B2C2B2I'
import { PHASE2C26B2C2B2J_OPTIMIZATION } from './plannerGlobalPhase2C26B2C2B2J'
import {
  parsePhase2C26B2C2B2KProbeManifest,
  phase2c26b2c2b2kRegisteredConditions,
  phase2c26b2c2b2kStartAttestationBody,
  runPhase2C26B2C2B2KTask,
  verifyPhase2C26B2C2B2KStartAttestation,
  PHASE2C26B2C2B2K_BASE_MAIN,
  PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS,
  PHASE2C26B2C2B2K_EXPECTED_TASKS,
  PHASE2C26B2C2B2K_INSTRUMENTATION,
  PHASE2C26B2C2B2K_NOT_RUN,
  PHASE2C26B2C2B2K_POPULATION,
  PHASE2C26B2C2B2K_PRODUCTION_CHANGED_FILES,
  PHASE2C26B2C2B2K_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2K_STAGE1,
  PHASE2C26B2C2B2K_START_ATTESTATION_PHASE,
  type Phase2C26B2C2B2KAttestationExpectation,
  type Phase2C26B2C2B2KLaunchObservation,
  type Phase2C26B2C2B2KProductionAudit,
  type Phase2C26B2C2B2KTaskInput,
} from './plannerGlobalPhase2C26B2C2B2K'
import searchSource from './plannerGlobalPhase2C26B2C2B2K.ts?raw'
import {
  parsePhase2C26B2C2B2KB2C2B2EAuthority,
  parsePhase2C26B2C2B2KB2C2B2IAuthority,
  parsePhase2C26B2C2B2KB2C2B2JAuthority,
  phase2c26b2c2b2kAdoptedOptimizations,
  phase2c26b2c2b2kOptimizedFileHeads,
  phase2c26b2c2b2kPopulation,
  phase2c26b2c2b2kProbeManifest,
  phase2c26b2c2b2kProductionAuditIssues,
  phase2c26b2c2b2kProductionChangedFiles,
  PHASE2C26B2C2B2K_REGISTERED_B2C2B2E,
  PHASE2C26B2C2B2K_REGISTERED_B2C2B2I,
  PHASE2C26B2C2B2K_REGISTERED_B2C2B2J,
} from './plannerGlobalPhase2C26B2C2B2KTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2KTargets.ts?raw'
import {
  phase2c26b2c2b2kDecision,
  phase2c26b2c2b2kE1Aggregate,
  phase2c26b2c2b2kEvidenceGrade,
  phase2c26b2c2b2kLaunchProvenance,
  phase2c26b2c2b2kPairedRow,
  phase2c26b2c2b2kRecovery,
  PHASE2C26B2C2B2K_DECISION_RULE,
  PHASE2C26B2C2B2K_E1_STATEMENT_JA,
  PHASE2C26B2C2B2K_NEXT_PHASE,
  type Phase2C26B2C2B2KRun,
  type Phase2C26B2C2B2KTargetRow,
} from './plannerGlobalPhase2C26B2C2B2KAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2KAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2k-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2k.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2k.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2K: the B2-C2B2E time-bound Target that timed out at 60 minutes / 12 GB, searched again on the current
 * optimized main in B2-C2B2E's exact Search input and execution conditions. The committed B2-C2B2E / B2-C2B2I / B2-C2B2J RESULTs are read
 * only to check the authorities; the oracle modules are never imported here. Synthetic values below are invented for the tests.
 */

type Json = Record<string, unknown>
const eJson = JSON.parse(rawB2C2B2E) as Json
const iJson = JSON.parse(rawB2C2B2I) as Json
const jJson = JSON.parse(rawB2C2B2J) as Json
const E_SHA = PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.resultSha256
const I_SHA = PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.resultSha256
const J_SHA = PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.resultSha256
const BONUS_STREAM = 'src/domain/search/bonusStream.ts'
const parsedE = () => parsePhase2C26B2C2B2KB2C2B2EAuthority(eJson, E_SHA)
const parsedI = () => parsePhase2C26B2C2B2KB2C2B2IAuthority(iJson, I_SHA)
const parsedJ = () => parsePhase2C26B2C2B2KB2C2B2JAuthority(jJson, J_SHA)
const patched = (json: Json, patch: (copy: Json & Record<string, never>) => void) => { const copy = structuredClone(json) as Json & Record<string, never>; patch(copy); return copy }
const eNextBranchTimeBound = () => ((eJson.nextBranch as Json).perTarget as Json[]).filter(row => row.type === 'time_bound' && row.result === 'timeout')

// ---------------------------------------------------------------- authorities and population

describe('Phase 2-C2.6-B2-C2B2K authorities and population', () => {
  it('reads the committed B2-C2B2E RESULT as the paired before authority: formal INCOMPLETE, its time-bound Target a 60-minute / 12,288 MB timeout with no record and no hit, failing closed otherwise', () => {
    const e = parsedE()
    expect(e.valid).toBe(true)
    expect(e.issues).toEqual([])
    expect(e.authority).toMatchObject({ decisionCase: 'B2C2B2E_INCOMPLETE', evidenceGrade: 'formal', measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.measuredHead })
    expect(e.facts!.b2c2b2e).toMatchObject({ process: 'timeout', budgetMs: 3_600_000, childHeapMb: 12_288, candidateCount: null, searchElapsedMs: null, termination: null,
      hit: { C8: false, C32: false, C4C: false } })
    expect(e.facts!.taskRow).toMatchObject({ process: 'timeout', record: null, candidateCount: null, budgetMs: 3_600_000 })
    expect(e.facts!.type).toBe('time_bound')
    expect(e.facts!.e1.diagnostic.C4C).toEqual({ recovered: 10, of: 11 })
    expect(e.facts!.e1.commonLadder.C4C).toEqual({ recovered: 9, of: 11 })
    expect(Object.keys(e.facts!.evidence).sort()).toEqual(['probeManifest', 'run', 'startAttestation'])
    expect(parsePhase2C26B2C2B2KB2C2B2EAuthority(eJson, '0'.repeat(64)).valid).toBe(false)
    const timeBound = eNextBranchTimeBound()[0]!
    const targetOf = (copy: Json) => (copy.targets as Json[]).find(t => t.targetWeaponId === timeBound.targetWeaponId)!
    for (const patch of [
      (c: Json) => { (c.conditions as Json).stage1 = { ...PHASE2C26B2C2B2E_STAGE1, budgetMs: 600_000 } },
      (c: Json) => { (c.decision as Json).case = 'B2C2B2E_ALL_C4C' },
      (c: Json) => { ((targetOf(c).paired as Json).b2c2b2e as Json).childHeapMb = 16_384 },
      (c: Json) => { (((targetOf(c).paired as Json).b2c2b2e as Json).hit as Json).C4C = true },
      (c: Json) => { ((c.sources as Json).run as Json).sha256 = 'x' },
      (c: Json) => { (c.nextBranch as Json).perTarget = [] },
    ]) expect(parsePhase2C26B2C2B2KB2C2B2EAuthority(patched(eJson, patch), E_SHA).valid).toBe(false)
  })

  it('reads the committed B2-C2B2I / B2-C2B2J RESULTs as the formal ADOPTED authorities of the optimized Production state, failing closed on another SHA-256, decision or Production change', () => {
    const i = parsedI(), j = parsedJ()
    expect(i.valid).toBe(true)
    expect(j.valid).toBe(true)
    expect(i.authority).toMatchObject({ decisionCase: 'B2C2B2I_ADOPTED', optimizationId: PHASE2C26B2C2B2I_OPTIMIZATION.id, productionChangedFiles: [BONUS_STREAM] })
    expect(j.authority).toMatchObject({ decisionCase: 'B2C2B2J_ADOPTED', optimizationId: PHASE2C26B2C2B2J_OPTIMIZATION.id, productionChangedFiles: [BONUS_STREAM], b2c2b2iResultSha256: I_SHA,
      b2c2b2eResultSha256: E_SHA, measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.measuredHead })
    expect(j.authority!.direct.stateGenerationDirectRatio).toBeLessThan(0.95)
    expect(parsePhase2C26B2C2B2KB2C2B2IAuthority(iJson, '0'.repeat(64)).valid).toBe(false)
    expect(parsePhase2C26B2C2B2KB2C2B2JAuthority(jJson, '0'.repeat(64)).valid).toBe(false)
    for (const patch of [
      (c: Json) => { (c.decision as Json).case = 'B2C2B2J_PARTIAL' },
      (c: Json) => { (c.provenance as Json).formal = false },
      (c: Json) => { (c.provenance as Json).productionOptimizationId = 'other' },
      (c: Json) => { (c.productionChange as Json).productionChangedBaseMainToMeasuredHead = [BONUS_STREAM, 'src/domain/search/other.ts'] },
      (c: Json) => { (c.productionChange as Json).productionChangedB2C2B2IToBaseMain = [BONUS_STREAM] },
      (c: Json) => { ((c.parity as Json).excludedRoute as Json).rederivedExcludedRouteKeySha256 = '0'.repeat(64) },
      (c: Json) => { c.invalidReasons = ['x'] },
    ]) expect(parsePhase2C26B2C2B2KB2C2B2JAuthority(patched(jJson, patch), J_SHA).valid).toBe(false)
    expect(parsePhase2C26B2C2B2KB2C2B2IAuthority(patched(iJson, c => { (c.productionChange as Json).productionChangedFiles = [] }), I_SHA).valid).toBe(false)
    expect(phase2c26b2c2b2kAdoptedOptimizations(i.authority!, j.authority!)).toEqual([
      { phase: 'B2-C2B2I', id: PHASE2C26B2C2B2I_OPTIMIZATION.id, files: [BONUS_STREAM], resultSha256: I_SHA, decisionCase: 'B2C2B2I_ADOPTED', measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.measuredHead },
      { phase: 'B2-C2B2J', id: PHASE2C26B2C2B2J_OPTIMIZATION.id, files: [BONUS_STREAM], resultSha256: J_SHA, decisionCase: 'B2C2B2J_ADOPTED', measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.measuredHead },
    ])
  })

  it('derives the population mechanically: exactly the B2-C2B2E Target with process timeout, recovery none and type time_bound, the same Target / probe / identity / excluded Route B2-C2B2I and B2-C2B2J searched', () => {
    const e = parsedE(), i = parsedI().authority!, j = parsedJ().authority!
    const derived = phase2c26b2c2b2kPopulation(e, i, j)
    expect(derived.valid).toBe(true)
    expect(Object.values(derived.chain).every(v => v === true)).toBe(true)
    const timeBound = eNextBranchTimeBound()
    expect(timeBound).toHaveLength(1)
    expect(derived.targetWeaponIds).toEqual([timeBound[0]!.targetWeaponId])
    expect(derived.probes).toHaveLength(PHASE2C26B2C2B2K_EXPECTED_TASKS)
    expect(derived.probes[0]!.b2c2b2dTaskId).toBe(timeBound[0]!.taskId)
    // The historical identity this phase expects, re-derived (never written in the source).
    expect(derived.probes[0]).toEqual({ targetWeaponId: 'a367c177-a0c2-4986-995e-4efcf4131b5c', b2c2b2dTaskId: 't02-r11', contextRank: 11,
      extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 1083 } })
    const eTask = (eJson.taskRows as Json[]).find(t => t.taskId === 't02-r11')!
    for (const field of ['groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId', 'representativeFixedTargetWeaponIds', 'defaultSearchInputDigest', 'searchInputDigest', 'extent']) {
      expect((derived.expectedTaskIdentities[0] as unknown as Json)[field]).toEqual(eTask[field])
    }
    expect(derived.excludedRouteKeySha256).toBe(e.facts!.rederivedExcludedRouteKeySha256)
    expect(phase2c26b2c2b2kPopulation(e, { ...i, excludedRouteKeySha256: '0'.repeat(64) }, j).valid).toBe(false)
    expect(phase2c26b2c2b2kPopulation(e, i, { ...j, probes: [{ ...j.probes[0]!, contextRank: 12 }] }).valid).toBe(false)
    expect(phase2c26b2c2b2kPopulation(e, i, { ...j, expectedTaskIdentity: { ...j.expectedTaskIdentity, searchInputDigest: 'fnv1a32:00000000' } }).valid).toBe(false)
    expect(phase2c26b2c2b2kPopulation(e, { ...i, b2c2b2eResultSha256: '0'.repeat(64) }, j).valid).toBe(false)
    expect(phase2c26b2c2b2kPopulation(null, i, j).valid).toBe(false)
  })

  it('writes only the probe, its expected Search input identity and the authority SHA-256s (no expected key / index / cost / Route kind / outcome), exactly what the Search runner accepts', () => {
    const manifest = phase2c26b2c2b2kProbeManifest(parsedE(), parsedI().authority!, parsedJ().authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'b2c2b2iResultSha256', 'b2c2b2jResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule',
      'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ population: PHASE2C26B2C2B2K_POPULATION, policy: 'P1', b2c2b2eResultSha256: E_SHA, b2c2b2iResultSha256: I_SHA, b2c2b2jResultSha256: J_SHA })
    // The population label is read by the parent only; the children receive the probe and the identity (tasks child) or the built task (Search child).
    expect(JSON.stringify({ probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities })).not.toMatch(/stableKey|expectedCandidate|operationCost|routeKind|oracle|timeout|time_bound|recovered|peakHeap|yields|1084/i)
    const parsed = parsePhase2C26B2C2B2KProbeManifest(JSON.parse(JSON.stringify(manifest)))
    expect(parsed.valid).toBe(true)
    expect(parsed.manifest).toEqual(manifest)
    for (const bad of [{ ...manifest, expectedStableKey: 'k' }, { ...manifest, population: 'other' }, { ...manifest, b2c2b2iResultSha256: 'x' },
      { ...manifest, probes: [...manifest.probes, manifest.probes[0]] }, { ...manifest, probes: [{ ...manifest.probes[0], expectedCandidateIndex: 0 }] },
      { ...manifest, expectedTaskIdentities: [{ ...manifest.expectedTaskIdentities[0], contextRank: 12 }] }]) {
      expect(parsePhase2C26B2C2B2KProbeManifest(bad).valid).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- registered conditions, task construction and child calculation

describe('Phase 2-C2.6-B2-C2B2K registered conditions and child calculation', () => {
  it('registers B2-C2B2E\'s Stage 1 unchanged (60 minutes / 12,288 MB / concurrency 1 / no retry / no fallback), no instrumentation and no Production change', () => {
    expect(PHASE2C26B2C2B2K_STAGE1).toEqual(PHASE2C26B2C2B2E_STAGE1)
    expect(PHASE2C26B2C2B2K_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 3_600_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS).toEqual([])
    expect(PHASE2C26B2C2B2K_INSTRUMENTATION).toEqual({ searchInstrumentation: 'none', cpuProfiler: false, profilingObserver: false, allocationProfiler: false, heapSnapshot: false })
    expect(PHASE2C26B2C2B2K_PRODUCTION_CHANGED_FILES).toEqual([])
    expect(PHASE2C26B2C2B2K_BASE_MAIN).toEqual({ pullRequest: 210, sha: 'd42a5cc83f33ffaa805746f84a07af29136ef694' })
    expect(PHASE2C26B2C2B2K_PROVENANCE_FLAGS).toMatchObject({ ...PHASE2C26B2C2B2E_PROVENANCE_FLAGS, oracleGuidedTargetPopulation: true, oracleGuidedContextSelection: true,
      oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false, expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false, productionExtentSelectionEvidence: false,
      profilingInstrumentation: false })
    for (const item of ['production_change', 'heap_16gb', 'budget_over_60min', 'retry', 'cpu_profiler', 'allocation_profiler', 'heap_snapshot', 'exact_early_stop', 'oracle_early_stop', 'global_assignment']) {
      expect(PHASE2C26B2C2B2K_NOT_RUN).toContain(item)
    }
  })

  it('runs B2-C2B2E\'s child calculation itself (= B2-C2B2D\'s, the same function object) and builds the task by B2-C2B2F\'s identity-gated B2-C2B2E construction', () => {
    expect(runPhase2C26B2C2B2KTask).toBe(runPhase2C26B2C2B2ETask)
    expect(runPhase2C26B2C2B2KTask).toBe(runPhase2C26B2C2B2DTask)
    expect(searchSource).toMatch(/export const runPhase2C26B2C2B2KTask = runPhase2C26B2C2B2ETask/)
    expect(searchSource).toMatch(/buildPhase2C26B2C2B2FTasks\(schedule, manifest\)/)
    // The Search module holds no Search body, capture, observer or profiler of its own.
    expect(searchSource).not.toMatch(/visitPlannerAlternativeCandidates|createPhase2C26B2C2ACapture|onSearchRuntime|onGogmaReservedRuntime|node:inspector|Profiler\.|'stop'/)
    // The runner child passes the yield control only (no instrumentation, no profiler, no heap snapshot), and the heap flag alone.
    const child = runnerSource.slice(runnerSource.indexOf("if (role !== 'parent') {"), runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    expect(child).toMatch(/k\.runPhase2C26B2C2B2KTask\(input, schedule, task, engine, \{ yieldControl: \(\) => new Promise\(done => \{ yields \+= 1; setImmediate\(done\) \}\) \}\)/)
    expect(runnerSource).not.toMatch(/node:inspector|Profiler\.start|--cpu-prof|--heap-prof|writeHeapSnapshot|heapsnapshot|onSearchRuntime|instrumentation: \{ on/)
    expect(runnerSource).toMatch(/const nodeFlags = \[`--max-old-space-size=\$\{heapMb\}`\]/)
    expect(runnerSource).toMatch(/await runChild\('tasks', 'tasks', \{ probes: manifest\.probes, expectedTaskIdentities: manifest\.expectedTaskIdentities \}/)
    expect(runnerSource).toMatch(/await runChild\(`stage1-\$\{task\.taskId\}`, 'search', task,/)
  })
})

// ---------------------------------------------------------------- runner start attestation and Production audit

const HEAD = '1'.repeat(40)
const E_MEASURED = PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.measuredHead
const adopted = () => phase2c26b2c2b2kAdoptedOptimizations(parsedI().authority!, parsedJ().authority!)
const audit = (patch: Partial<Phase2C26B2C2B2KProductionAudit> = {}): Phase2C26B2C2B2KProductionAudit => ({ b2c2b2eMeasuredHead: E_MEASURED, productionChangedSinceB2C2B2E: [BONUS_STREAM],
  adoptedOptimizationFiles: [BONUS_STREAM], productionChangedSinceBaseMain: [], baseMainIsAncestor: true,
  mainCommits: [{ sha: '2'.repeat(40), subject: 'B2-C2B2I', productionChangedFiles: [BONUS_STREAM] }, { sha: '3'.repeat(40), subject: '#209', productionChangedFiles: [] }],
  optimizedFilesEqualMeasured: [{ file: BONUS_STREAM, measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.measuredHead, equal: true }], ...patch })
const manifestOf = () => phase2c26b2c2b2kProbeManifest(parsedE(), parsedI().authority!, parsedJ().authority!)
const evidenceOf = () => parsedE().facts!.evidence
const observation = (): Phase2C26B2C2B2KLaunchObservation => {
  const manifest = manifestOf()
  return { createdAt: '2026-10-06T01:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2k.mjs', node: 'v24', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
    benchmarkCodeSha256: 'c'.repeat(64), exportFileName: 'export.json', exportSha256: manifest.exportSha256, exportBytes: 1, probeManifestFileName: 'probes.json', probeManifestSha256: 'd'.repeat(64),
    b2c2b2eResultSha256: E_SHA, b2c2b2iResultSha256: I_SHA, b2c2b2jResultSha256: J_SHA, b2c2b2eEvidence: structuredClone(evidenceOf()), adoptedOptimizations: adopted(), productionAudit: audit(),
    targetWeaponIds: manifest.probes.map(p => p.targetWeaponId), probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities,
    machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0.1 }, stage1: phase2c26b2c2b2kRegisteredConditions().stage1, smoke: null }
}
const expectation = (): Phase2C26B2C2B2KAttestationExpectation => {
  const manifest = manifestOf()
  return { repositoryHead: HEAD, benchmarkCodeSha256: 'c'.repeat(64), exportSha256: manifest.exportSha256, probeManifestSha256: 'd'.repeat(64), b2c2b2eResultSha256: E_SHA, b2c2b2iResultSha256: I_SHA,
    b2c2b2jResultSha256: J_SHA, b2c2b2eEvidence: evidenceOf(), adoptedOptimizations: adopted(), b2c2b2eMeasuredHead: E_MEASURED, probes: manifest.probes,
    expectedTaskIdentities: manifest.expectedTaskIdentities, firstChildStartedAt: '2026-10-06T01:00:00.050Z' }
}

describe('Phase 2-C2.6-B2-C2B2K runner start attestation and Production audit', () => {
  it('carries every registered condition and the launch observation, and verifies only against the independently obtained values', () => {
    const attestation = phase2c26b2c2b2kStartAttestationBody(observation())
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2K_START_ATTESTATION_PHASE, stage1: PHASE2C26B2C2B2E_STAGE1, b2c2b2eStage1: PHASE2C26B2C2B2E_STAGE1,
      changedStage1Fields: [], expectedTasks: 1, candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 }, instrumentation: PHASE2C26B2C2B2K_INSTRUMENTATION,
      registeredProductionChangedFiles: [], smoke: null })
    expect(verifyPhase2C26B2C2B2KStartAttestation(attestation, expectation())).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const integrity = (patch: Json) => verifyPhase2C26B2C2B2KStartAttestation({ ...attestation, ...patch }, expectation()).integrityIssues.length > 0
    const verifies = (patch: Json) => verifyPhase2C26B2C2B2KStartAttestation({ ...attestation, ...patch }, expectation()).verified
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { b2c2b2eResultSha256: '0'.repeat(64) }, { b2c2b2jResultSha256: '0'.repeat(64) }, { b2c2b2eEvidence: { ...evidenceOf(), run: { file: 'x', sha256: '0'.repeat(64) } } },
      { adoptedOptimizations: adopted().slice(1) }, { targetWeaponIds: ['t1'] }, { probes: [] }, { expectedTaskIdentities: [] }, { attestedBy: 'reconstruction' },
      { createdAt: '2026-10-06T01:00:01.000Z' }, { extra: 1 }, { productionAudit: { ...audit(), b2c2b2eMeasuredHead: HEAD } }]) {
      expect(integrity(patch)).toBe(true)
      expect(verifies(patch)).toBe(false)
    }
    // A truthfully attested non-formal launch, a changed condition or a Production change of this phase never verifies.
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { budgetMs: 20_000 } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1, budgetMs: 7_200_000 } },
      { stage1: { ...PHASE2C26B2C2B2E_STAGE1, childHeapMb: 16_384 } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1, retry: 'once' } }, { changedStage1Fields: ['budgetMs'] },
      { instrumentation: { ...PHASE2C26B2C2B2K_INSTRUMENTATION, cpuProfiler: true } }, { provenanceFlags: { ...PHASE2C26B2C2B2K_PROVENANCE_FLAGS, oracleReadBySearchChild: true } },
      { productionAudit: audit({ productionChangedSinceBaseMain: [BONUS_STREAM] }) }, { productionAudit: audit({ baseMainIsAncestor: false }) },
      { productionAudit: audit({ productionChangedSinceB2C2B2E: [BONUS_STREAM, 'src/domain/x.ts'] }) },
      { productionAudit: audit({ optimizedFilesEqualMeasured: [{ file: BONUS_STREAM, measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.measuredHead, equal: false }] }) }]) {
      expect(integrity(patch)).toBe(false)
      expect(verifies(patch)).toBe(false)
    }
    expect(verifyPhase2C26B2C2B2KStartAttestation(null, expectation()).verified).toBe(false)
  })

  it('grades launch provenance by the attestation file alone and requires the raw environment to agree on every launch field', () => {
    const attestation = phase2c26b2c2b2kStartAttestationBody(observation())
    const file = { sha256: 'e'.repeat(64), body: attestation }
    const environment = { ...attestation } as unknown as Json
    expect(phase2c26b2c2b2kLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: expectation() })).toMatchObject({ verified: true, issues: [] })
    expect(phase2c26b2c2b2kLaunchProvenance({ attestationFile: null, recordedAttestationSha256: null, environment, expected: expectation() })).toMatchObject({ verified: false, source: 'none' })
    expect(phase2c26b2c2b2kLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation() }).verified).toBe(false)
    for (const field of ['productionAudit', 'adoptedOptimizations', 'b2c2b2eEvidence', 'expectedTaskIdentities', 'stage1']) {
      expect(phase2c26b2c2b2kLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment: { ...environment, [field]: null }, expected: expectation() }).verified).toBe(false)
    }
    expect(phase2c26b2c2b2kEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: false })).toBe('formal')
    expect(phase2c26b2c2b2kEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: false })).toBe('non_formal')
  })

  it('accepts only the optimized current Production state: no change since the base main, exactly the adopted files since B2-C2B2E, each the file at the last optimization\'s measured HEAD', () => {
    expect(phase2c26b2c2b2kOptimizedFileHeads(adopted())).toEqual([{ file: BONUS_STREAM, measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.measuredHead }])
    expect(phase2c26b2c2b2kProductionAuditIssues(audit(), adopted(), E_MEASURED)).toEqual([])
    for (const bad of [audit({ baseMainIsAncestor: false }), audit({ productionChangedSinceBaseMain: ['src/domain/search/x.ts'] }), audit({ productionChangedSinceB2C2B2E: [] }),
      audit({ productionChangedSinceB2C2B2E: [BONUS_STREAM, 'src/domain/x.ts'] }), audit({ mainCommits: [{ sha: '4'.repeat(40), subject: 'x', productionChangedFiles: ['src/domain/x.ts'] }] }),
      audit({ optimizedFilesEqualMeasured: [] }), audit({ optimizedFilesEqualMeasured: [{ file: BONUS_STREAM, measuredHead: PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.measuredHead, equal: true }] }),
      audit({ b2c2b2eMeasuredHead: HEAD })]) {
      expect(phase2c26b2c2b2kProductionAuditIssues(bad, adopted(), E_MEASURED).length).toBeGreaterThan(0)
    }
    expect(phase2c26b2c2b2kProductionChangedFiles(['src/benchmarks/a.ts', 'scripts/b.mjs', 'docs/c.md', 'src/domain/search/x.test.ts', 'src/test/fixtures/y.ts', BONUS_STREAM, BONUS_STREAM]))
      .toEqual([BONUS_STREAM])
  })

  it('is written by the runner once and read-only before the tasks child and the Search child; the parent alone reads the authorities and refuses a formal launch on any mismatch', () => {
    const write = runnerSource.indexOf('await write(attestationPath, attestation)')
    const chmod = runnerSource.indexOf('await chmod(attestationPath, 0o444)')
    const tasksChild = runnerSource.indexOf("await runChild('tasks', 'tasks'")
    const searchChild = runnerSource.indexOf("await runChild(`stage1-${task.taskId}`, 'search'")
    expect(write).toBeGreaterThan(0)
    expect(write).toBeLessThan(chmod)
    expect(chmod).toBeLessThan(tasksChild)
    expect(tasksChild).toBeLessThan(searchChild)
    for (const guard of [/The B2-C2B2E raw evidence is not the recorded one; no formal run/, /The Production audit fails; no formal run/, /The probe manifest is not the one the authorities re-derive/,
      /The start attestation does not verify/, /Commit ALL benchmark code before a formal measurement/]) expect(runnerSource).toMatch(guard)
    const parent = runnerSource.slice(runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    expect(parent).toMatch(/parsePhase2C26B2C2B2KB2C2B2EAuthority/)
    // No retry: Stage 1 runs each task once.
    expect(runnerSource.match(/runChild\(`stage1-/g)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- analysis: paired comparison, decision, recovery, E1 aggregate

const facts = () => parsedE().facts!
const taskOf = (): Phase2C26B2C2B2KTaskInput => {
  const row = facts().taskRow
  return { taskId: row.taskId, targetWeaponId: row.targetWeaponId, contextRank: row.contextRank, groupIndex: row.groupIndex, reservationDigest: row.reservationDigest,
    targetEligibleMinCardinality: row.targetEligibleMinCardinality, representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds],
    defaultSearchInputDigest: row.defaultSearchInputDigest, searchInputDigest: row.searchInputDigest, extent: { ...row.extent } } as unknown as Phase2C26B2C2B2KTaskInput
}
const rederivation = (patch: Partial<Phase2C26B2C2B2DBaselineRederivation> = {}): Phase2C26B2C2B2DBaselineRederivation => {
  const row = facts().taskRow
  return { taskId: row.taskId, valid: true, issues: [], scheduleRows: 1, groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
    representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], defaultSearchInputDigest: row.defaultSearchInputDigest,
    bodyDigestMatches: true, excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true, excludedRouteKeySha256: facts().rederivedExcludedRouteKeySha256, ...patch }
}
const comparison = (hit = { C8: false, C32: false, C4C: false }, firstExactIndex: number | null = null, firstExactCost: number | null = null) =>
  ({ hit, firstExactIndex, firstExactCost }) as unknown as Phase2C26B2C2B2DContextComparison
const searchedRun = (candidates: { routeKind: string; cost: number }[]): Phase2C26B2C2B2KRun => ({
  taskId: taskOf().taskId, task: taskOf(), outcome: { process: 'completed', record: 'searched' },
  process: { outcome: 'completed', wallMs: 1_200_000, timedOut: false, budgetMs: 3_600_000, exitCode: 0, stderrTail: null, startedAt: '', endedAt: '' },
  yields: 9_000_000, memory: { sampledMaxHeapUsedBytes: 7e9, sampledMaxRssBytes: 8e9, maxRssKiB: 0, samples: 1, heapSizeLimitBytes: 0 }, lastIpcMemory: null,
  record: { status: 'searched', taskId: taskOf().taskId, search: { status: 'consumer_stop', termination: 'four_cost_cohorts_drained', elapsedMs: 1_100_000, capturedCosts: [...new Set(candidates.map(c => c.cost))],
    safetyCapHit: false, excludedRouteKeys: ['excluded'], summary: { deliveredCandidates: candidates.length + 1 },
    candidates: candidates.map((c, deliveryIndex) => ({ deliveryIndex, summary: { routeKind: c.routeKind, sourceKind: 'owned' } })) } },
} as unknown as Phase2C26B2C2B2KRun)
const timeoutRun = (): Phase2C26B2C2B2KRun => ({ taskId: taskOf().taskId, task: taskOf(), outcome: { process: 'timeout', record: null },
  process: { outcome: 'timeout', wallMs: 3_600_100, timedOut: true, budgetMs: 3_600_000, exitCode: null, stderrTail: '', startedAt: '', endedAt: '' }, yields: 30_000_000, memory: null,
  lastIpcMemory: { maxHeapUsedBytes: 7.5e9, maxRssBytes: 8e9 }, record: null } as unknown as Phase2C26B2C2B2KRun)
const CONDITIONS = { budgetMs: 3_600_000, childHeapMb: 12_288 }

describe('Phase 2-C2.6-B2-C2B2K analysis', () => {
  it('pairs the task with B2-C2B2E\'s own task: identical Search input, excluded current Route proved by re-derivation, identical execution conditions; any drift fails closed', () => {
    const ok = phase2c26b2c2b2kPairedRow(taskOf(), timeoutRun(), comparison(), null, facts(), rederivation(), CONDITIONS)
    expect(ok.identity).toMatchObject({ matches: true, issues: [], excludedRouteKeyComparison: { verified: true, b2c2b2kSource: 'rederived_default_context' } })
    expect(ok.outcomeTransition).toBe('timeout -> timeout')
    expect(ok.b2c2b2e).toEqual(facts().b2c2b2e)
    // Unmeasured is never Candidate 0.
    expect(ok.b2c2b2k).toMatchObject({ process: 'timeout', candidateCount: null, searchElapsedMs: null, termination: null })
    const recorded = 'r'.repeat(64)
    expect(phase2c26b2c2b2kPairedRow(taskOf(), searchedRun([]), comparison(), facts().rederivedExcludedRouteKeySha256, facts(), rederivation(), CONDITIONS).identity
      .excludedRouteKeyComparison).toMatchObject({ verified: true, b2c2b2kSource: 'b2c2b2k_record', b2c2b2kRecordMatchesRederived: true })
    for (const bad of [
      phase2c26b2c2b2kPairedRow({ ...taskOf(), extent: { ...taskOf().extent, maxSkillAdvance: 1500 } }, timeoutRun(), comparison(), null, facts(), rederivation(), CONDITIONS),
      phase2c26b2c2b2kPairedRow({ ...taskOf(), searchInputDigest: 'fnv1a32:00000000' }, timeoutRun(), comparison(), null, facts(), rederivation(), CONDITIONS),
      phase2c26b2c2b2kPairedRow(taskOf(), timeoutRun(), comparison(), null, facts(), rederivation({ excludedRouteKeySha256: '0'.repeat(64) }), CONDITIONS),
      phase2c26b2c2b2kPairedRow(taskOf(), timeoutRun(), comparison(), null, facts(), null, CONDITIONS),
      phase2c26b2c2b2kPairedRow(taskOf(), searchedRun([]), comparison(), recorded, facts(), rederivation(), CONDITIONS),
      phase2c26b2c2b2kPairedRow(taskOf(), searchedRun([]), comparison(), null, facts(), rederivation(), CONDITIONS),
      phase2c26b2c2b2kPairedRow(taskOf(), timeoutRun(), comparison(), null, facts(), rederivation(), { budgetMs: 3_600_000, childHeapMb: 16_384 }),
      phase2c26b2c2b2kPairedRow(taskOf(), timeoutRun(), comparison(), null, facts(), rederivation(), { budgetMs: 7_200_000, childHeapMb: 12_288 }),
    ]) expect(bad.identity.matches).toBe(false)
  })

  it('decides INVALID / INCOMPLETE / RECOVERED / MEASURED_NO_EXACT for the one Target, never from a speed ratio, and rejects an inconsistent input', () => {
    const none = { C8: 0, C32: 0, C4C: 0 }
    expect(phase2c26b2c2b2kDecision({ invalidReasons: ['x'], tasks: 1, targets: 1, measuredTasks: 1, exactTargets: { C8: 1, C32: 1, C4C: 1 } }).case).toBe('B2C2B2K_INVALID')
    expect(phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 2, targets: 2, measuredTasks: 2, exactTargets: none }).case).toBe('B2C2B2K_INVALID')
    expect(phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 1, targets: 1, measuredTasks: 0, exactTargets: none })).toMatchObject({ case: 'B2C2B2K_INCOMPLETE',
      nextPhase: PHASE2C26B2C2B2K_NEXT_PHASE.B2C2B2K_INCOMPLETE })
    for (const exact of [{ C8: 1, C32: 1, C4C: 1 }, { C8: 0, C32: 1, C4C: 1 }, { C8: 0, C32: 0, C4C: 1 }]) {
      expect(phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 1, targets: 1, measuredTasks: 1, exactTargets: exact }).case).toBe('B2C2B2K_RECOVERED')
    }
    expect(phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 1, targets: 1, measuredTasks: 1, exactTargets: none }).case).toBe('B2C2B2K_MEASURED_NO_EXACT')
    expect(() => phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 1, targets: 1, measuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 1 } })).toThrow()
    expect(() => phase2c26b2c2b2kDecision({ invalidReasons: [], tasks: 1, targets: 1, measuredTasks: 1, exactTargets: { C8: 1, C32: 0, C4C: 1 } })).toThrow()
    expect(PHASE2C26B2C2B2K_DECISION_RULE.order.map(o => o.split(':')[0])).toEqual(['B2C2B2K_INVALID', 'B2C2B2K_INCOMPLETE', 'B2C2B2K_RECOVERED', 'B2C2B2K_MEASURED_NO_EXACT'])
    expect(PHASE2C26B2C2B2K_DECISION_RULE.scope).toMatch(/A speed ratio is never a decision input/)
    expect(PHASE2C26B2C2B2K_NEXT_PHASE.B2C2B2K_RECOVERED).toMatch(/oracleなしでcontext \/ extent \/ budget/)
    expect(PHASE2C26B2C2B2K_NEXT_PHASE.B2C2B2K_MEASURED_NO_EXACT).toMatch(/Route不存在とは結論しない/)
  })

  it('records the recovery post hoc: smallest policy, exact index, cost, Route kind, capture and resources; an unmeasured run keeps every Search field null', () => {
    const row = { taskId: taskOf().taskId, recovery: 'C32', hit: { C8: false, C32: true, C4C: true }, firstExactIndex: 9, firstExactCost: 1084, oracleOperationCost: 1084, missClass: null } as unknown as Phase2C26B2C2B2KTargetRow
    const run = searchedRun(Array.from({ length: 12 }, (_, index) => ({ routeKind: index === 9 ? 'existing_gogma_mixed' : 'existing_gogma_reset_skills', cost: 1084 })))
    expect(phase2c26b2c2b2kRecovery(row, run, 1_150_000)).toMatchObject({ recovered: true, policy: 'C32', exactIndex: 9, operationCost: 1084, routeKind: 'existing_gogma_mixed', sourceKind: 'owned',
      capturedCount: 12, termination: 'four_cost_cohorts_drained', searchElapsedMs: 1_100_000, childWallMs: 1_150_000, processWallMs: 1_200_000, yields: 9_000_000 })
    const miss = { taskId: taskOf().taskId, recovery: 'none', hit: { C8: false, C32: false, C4C: false }, firstExactIndex: null, firstExactCost: null, oracleOperationCost: 1084,
      missClass: 'unmeasured' } as unknown as Phase2C26B2C2B2KTargetRow
    expect(phase2c26b2c2b2kRecovery(miss, timeoutRun(), null)).toMatchObject({ recovered: false, policy: 'none', exactIndex: null, routeKind: null, capturedCount: null, termination: null,
      searchElapsedMs: null, processWallMs: 3_600_100, peakHeapBytes: 7.5e9, yields: 30_000_000, missClass: 'unmeasured' })
  })

  it('states the E1 11 / 11 oracle-guided diagnostic evidence only for a formal RECOVERED run, keeping the common ladder unchanged and never stating anything for Production', () => {
    const recovered = { recovery: 'C4C', hit: { C8: false, C32: false, C4C: true } } as unknown as Phase2C26B2C2B2KTargetRow
    const miss = { recovery: 'none', hit: { C8: false, C32: false, C4C: false } } as unknown as Phase2C26B2C2B2KTargetRow
    const all = phase2c26b2c2b2kE1Aggregate({ facts: facts(), row: recovered, decision: 'B2C2B2K_RECOVERED', evidenceGrade: 'formal' })
    expect(all.issues).toEqual([])
    expect(all.diagnostic.total).toEqual({ C8: { recovered: 8, of: 11 }, C32: { recovered: 9, of: 11 }, C4C: { recovered: 11, of: 11 } })
    expect(all.diagnostic).toMatchObject({ allRecovered: true, statement: PHASE2C26B2C2B2K_E1_STATEMENT_JA })
    expect(all.commonLadder.total.C4C).toEqual({ recovered: 9, of: 11 })
    expect(all.commonLadder.statement).toBeNull()
    expect(all.diagnostic.statementScope).toMatch(/not "11 \/ 11 by a Production scheduler"/)
    expect(PHASE2C26B2C2B2K_E1_STATEMENT_JA).toMatch(/oracle-guided target\/context\/extent/)
    expect(PHASE2C26B2C2B2K_E1_STATEMENT_JA).not.toMatch(/Production|scheduler|default extent/)
    const c8 = phase2c26b2c2b2kE1Aggregate({ facts: facts(), row: { recovery: 'C8', hit: { C8: true, C32: true, C4C: true } } as unknown as Phase2C26B2C2B2KTargetRow,
      decision: 'B2C2B2K_RECOVERED', evidenceGrade: 'formal' })
    expect(c8.diagnostic.total).toEqual({ C8: { recovered: 9, of: 11 }, C32: { recovered: 10, of: 11 }, C4C: { recovered: 11, of: 11 } })
    for (const [row, decision, grade] of [[miss, 'B2C2B2K_INCOMPLETE', 'formal'], [miss, 'B2C2B2K_MEASURED_NO_EXACT', 'formal'], [recovered, 'B2C2B2K_RECOVERED', 'non_formal']] as const) {
      const aggregate = phase2c26b2c2b2kE1Aggregate({ facts: facts(), row, decision, evidenceGrade: grade })
      expect(aggregate.diagnostic.allRecovered).toBe(false)
      expect(aggregate.diagnostic.statement).toBeNull()
    }
    expect(phase2c26b2c2b2kE1Aggregate({ facts: facts(), row: miss, decision: 'B2C2B2K_INCOMPLETE', evidenceGrade: 'formal' }).diagnostic.total.C4C).toEqual({ recovered: 10, of: 11 })
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2K isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, task, rank or extent value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2K/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|a367c177/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(235|1083|1084)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, every RESULT and every earlier measurement out of the Search side; the Search child never learns what counts as a recovery', () => {
    const child = runnerSource.slice(runnerSource.indexOf("if (role !== 'parent') {"), runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    for (const source of [searchSource, child]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|gogmaUsage|plannerGlobal[O]racle|phase2c2OracleCoverage|Analysis'|Targets'|expectedStableKey|expectedCandidateIndex|expectedOperationCost|peakHeapBytes|_RESULT|--b2c2b2[eij]-result/)
    }
    expect(child).not.toMatch(/kTargets|parsePhase2C26B2C2B2KB2C2B2/)
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2[A-K]Targets|plannerGlobalPhase2C26B2C2B2[A-K]Analysis|plannerGlobalPhase2C26B2C1Analysis/)
    expect(runnerSource).toMatch(/\.\.\.k\.PHASE2C26B2C2B2K_PROVENANCE_FLAGS/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analysisSource).toMatch(/runPhase2C26B2C2B2EAnalysis\(/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DEK]Task\(/)
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
  })
})
