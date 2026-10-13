import { hashStableValue } from '../../domain/models/publicTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { judgeD0cFormalValidity, MATERIALIZATION_D0C_PHASE, MATERIALIZATION_D0C_REGISTRATION_HEAD, readCalculationCodeAudit, summarizeD0cMaterializationOutcome } from './materializationFormal'
import type { D0cChildRecord, D0cPublicResultSources, D0cRunnerOutput, D0cRunnerOutputRun } from './materializationFormalResult'
import { d0cRegistrationGate, materializationProtocolVersion, parseProgressJournal, type ShapeMaterializationResearchConditions } from './materializationProtocol'
import { runMaterializationSmoke, type MaterializationRunExecution } from './materializationRunner'
import { materializationScenario, OPEN_GATE, type MaterializationScenarioSpec } from './materializationTestFixture'
import { V1_GOLDEN_RUNNER_SPECS } from './materializationV1GoldenTestFixture'
import { OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE } from './shapeMaterializationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0C test fixture: the raw outputs of a formal run as the runner script writes them (the
 * aggregated RESULT and two child records), built from a synthetic materialization scenario with the fixture Engine, so the public
 * RESULT derivation and its checks run on records of the real shape without the real Export. The semantic hash function is the
 * caller's (a script test passes SHA-256, the rule the runner and the derivation script use; `src` imports no Node module).
 */

export function d0cFixtureConditions(overrides: Partial<ShapeMaterializationResearchConditions> = {}): ShapeMaterializationResearchConditions {
  return {
    rule: 'd0a2-v2', window: { skill: 3, gogma: 5, normal: 2 }, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 1,
    projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 }, shapeSearchScaleGate: OPEN_SHAPE_GATE, shapeSearchBudget: OPEN_SHAPE_BUDGET,
    routeVerification: 'every_shape_constrained_materialization', ...overrides,
  }
}

export interface D0cFixtureOptions {
  spec?: MaterializationScenarioSpec
  conditions?: ShapeMaterializationResearchConditions
  execution?: Partial<MaterializationRunExecution>
  /** Make the second child unmeasured (timeout) with a journal that stopped inside a Target. */
  secondTimedOut?: boolean
  runDir?: string
  /** The hash of `JSON.stringify(record.semantic)` (default: the domain's stable hash; the runner uses SHA-256). */
  semanticHash?: (text: string) => string
}

/** The raw sources of a formal run over the synthetic scenario (records, aggregated RESULT, file identities, semantic hashes). */
export async function d0cFixtureSources(options: D0cFixtureOptions = {}): Promise<D0cPublicResultSources> {
  const spec = options.spec ?? V1_GOLDEN_RUNNER_SPECS.held_crossing
  const conditions = options.conditions ?? d0cFixtureConditions()
  const scene = await materializationScenario(spec)
  const protocolVersion = materializationProtocolVersion(conditions)
  const headSha = 'a'.repeat(40)
  const actualExport = { fileName: 'fixture-export.json', bytes: 10, sha256: 'e'.repeat(64) }
  const childCount = options.secondTimedOut ? 1 : 2
  const records: { id: string; record: D0cChildRecord }[] = []
  for (let index = 1; index <= childCount; index += 1) {
    let tick = 0
    const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1), ...(options.execution ?? {}) })
    const targets = result.semantic.candidates[0]?.targets ?? []
    records.push({
      id: `materialize-${index}`,
      record: {
        mode: 'formal', protocolVersion, rngEngineVersion: scene.engine.version, calculationContext: { ...scene.input.calculationContext },
        semantic: result.semantic, observed: { ...result.observed, setupMs: 1.5, wallMs: 40 + index, eventLoopYields: 3 },
        memory: {
          maxima: { heapUsed: 100 * index, heapTotal: 200, rss: 300, external: 4, samples: 5 }, heapSizeLimit: 4_000, maxRssKiB: 900,
          targets: targets.map(target => ({ orderIndex: target.orderIndex, settled: { heapUsed: 50 + target.orderIndex, rss: 70 }, sampledMax: { heapUsed: 60 + target.orderIndex, rss: 80 } })),
        },
      },
    })
  }
  const semanticHash = options.semanticHash ?? ((text: string) => hashStableValue(text))
  const semanticSha256ByRun = Object.fromEntries(records.map(entry => [entry.id, semanticHash(JSON.stringify(entry.record.semantic))]))
  const runs: D0cRunnerOutputRun[] = records.map(entry => ({
    id: entry.id, status: 'measured', reason: null, recordFile: `${entry.id}.record.json`, semanticSha256: semanticSha256ByRun[entry.id]!,
    recordComplete: true, recordConsistent: true, childGatePassed: true, calculationContextMatched: true,
  }))
  let unmeasuredProgress = null
  if (options.secondTimedOut) {
    const firstTarget = records[0]!.record.semantic.candidates[0]!.targets[0]!
    const journal = [
      { kind: 'started', atMs: 0, pid: 9 },
      { kind: 'progress', atMs: 1, event: { kind: 'context', status: 'context', planningTargetCount: 2, reason: null } },
      { kind: 'progress', atMs: 2, event: { kind: 'candidate_started', candidateIndex: 0, ordinal: 0, objective: 1, targetCount: 2 } },
      { kind: 'progress', atMs: 3, event: { kind: 'target_started', candidateIndex: 0, orderIndex: 0, targetWeaponId: firstTarget.targetWeaponId } },
    ].map(line => JSON.stringify(line)).join('\n')
    unmeasuredProgress = parseProgressJournal(journal)
    runs.push({ id: 'materialize-2', status: 'unmeasured', reason: 'timeout', recordFile: null, semanticSha256: null, recordComplete: null, recordConsistent: null, childGatePassed: null, calculationContextMatched: null, confirmedProgress: unmeasuredProgress })
  }
  const measured = records.map(entry => entry.record.semantic)
  const integrityIssues = measured.flatMap((semantic, index) => semantic.integrityIssues.map(issue => `materialize-${index + 1}: ${issue}`))
  const identical = measured.length >= 2 ? new Set(Object.values(semanticSha256ByRun)).size === 1 : null
  const audit = { registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, registrationHeadIsAncestor: true, changedFiles: ['scripts/run-planner-global-assignment-d0b.mjs'], error: null }
  const registration = d0cRegistrationGate()
  const formalValidity = judgeD0cFormalValidity({
    mode: 'formal', registration: { ...registration, requiredRuns: 2 },
    provenance: {
      startIssues: [], measurementHeadSha: headSha, benchmarkCodeSha256: 'c'.repeat(64), workingTreeClean: true, uncommittedBenchmarkCode: false, overrideOptions: [], differencesFromRegistration: [],
      exportVerification: { registeredMatched: true, cliMatched: true }, calculationAudit: audit,
    },
    runs: runs.map(run => ({ id: run.id, status: run.status, reason: run.reason, semanticSha256: run.semanticSha256, recordComplete: run.recordComplete, recordConsistent: run.recordConsistent,
      childGatePassed: run.childGatePassed, calculationContextMatched: run.calculationContextMatched, integrityIssues: run.status === 'measured' ? records.find(entry => entry.id === run.id)!.record.semantic.integrityIssues : [] })),
    determinism: { identical }, integrityIssues,
  })
  const runDir = options.runDir ?? 'd0c-fixture.run'
  const output: D0cRunnerOutput = {
    protocolVersion, phase: MATERIALIZATION_D0C_PHASE, mode: 'formal', nature: 'fixture', oracleFreeExecution: true, oracleInformedDesign: true,
    repositoryHeadSha: headSha, registrationHead: MATERIALIZATION_D0C_REGISTRATION_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, benchmarkCodeSha256: 'c'.repeat(64),
    calculationAudit: readCalculationCodeAudit(audit), registrationDoc: { source: 'HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', sha256: 'd'.repeat(64) },
    runnerScript: 'scripts/run-planner-global-assignment-d0b.mjs', node: 'v0', v8: '0',
    exportVerification: { actual: actualExport, cliExpectedSha256: actualExport.sha256, cliMatched: true, registeredSource: 'HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', registered: actualExport, registeredIssues: [], registeredMatched: true },
    plannerInputMaxPlanStepsForValidationOnly: 1_000,
    conditions: { ...conditions }, envelope: { childWallMs: 1_800_000, childHeapMb: 4_096, repeat: 2, concurrency: 1, retry: 'none' },
    conditionBasis: { window: 'registered condition (fixture)' }, overrideOptions: [],
    formalRegistration: { registeredIn: 'Phase D-0B-2', formalRunEnabled: true, registrationIssues: [], registeredItemKeys: ['window'], registeredConditionsSha256: 'f'.repeat(64), differencesFromRegistration: [], conditionsMatchRegistration: true, startIssues: [] },
    launchedAt: '2026-10-13T00:00:00.000Z', machine: { cpuModel: 'fixture', logicalCpuCount: 1 },
    status: 'formal', formalValidity,
    materializationOutcome: summarizeD0cMaterializationOutcome({ measured, unmeasuredProgress: measured.length === 0 ? unmeasuredProgress : null }),
    runs,
    determinism: { runs: runs.length, measuredRuns: records.length, identical, semanticSha256s: records.map(entry => semanticSha256ByRun[entry.id]!) },
    processes: runs.map(run => ({
      id: run.id, outcome: run.status === 'measured' ? 'completed' : 'timeout', exitCode: run.status === 'measured' ? 0 : null, signal: null, timedOut: run.status !== 'measured', cancelled: false,
      settledBy: 'close', wallObservedMs: 50, wallMs: 1_800_000, heapMb: 4_096, startedAt: '2026-10-13T00:00:01.000Z', recordWritten: run.status === 'measured',
    })),
    integrityIssues, totalWallMs: 100, claims: 'none',
  }
  ;(output as unknown as Record<string, unknown>).runDir = `/fixture/${runDir}`
  const files = [{ file: 'd0c-fixture.result.json', bytes: 1, sha256: '1'.repeat(64) }, ...records.map(entry => ({ file: `${runDir}/${entry.id}.record.json`, bytes: 2, sha256: '2'.repeat(64) }))]
  return { output, records, files, semanticSha256ByRun }
}
