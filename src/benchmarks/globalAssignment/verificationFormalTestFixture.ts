import { hashStableValue } from '../../domain/models/publicTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { d0cFixtureConditions } from './materializationFormalTestFixture'
import { runMaterializationSmoke, type MaterializedEntriesHandoff } from './materializationRunner'
import { ELEMENT_A, ELEMENT_B, materializationScenario, OPEN_GATE } from './materializationTestFixture'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'
import {
  concludeD1cMeasurement, D1C_FORMAL_PROTOCOL_VERSION, d1cFormalStartGate, observeD1cRegisteredD0c, observeD1cRegisteredExport, observeD1cRegistration,
  PLANNER_VERIFICATION_D1C_PHASE, registeredD1cExpectation,
  type D1cCalculationCodeAudit, type D1cMeasurementObservation, type D1cProcessEntry, type D1cRegisteredExpectation, type D1cRole,
} from './verificationFormal'
import type { D1cPublicResultSources, D1cRawOutput, D1cStartRecord } from './verificationFormalResult'
import {
  compareD0cMaterializationIdentity, createD1aEntrySet, handoffFromEntrySet, materializedEntriesFingerprintOfSemantic, type D1aCheckoutState, type D1aChildReading,
} from './verificationProtocol'
import { d1cRegistrationFingerprint } from './verificationRegistration'
import { verifyPlannerCandidate } from './verify'

/*
 * Issue #154 Global Assignment Phase D-1C test fixture: the raw observations of a formal measurement as the runner script records them
 * (the start provenance, two complete runs of a first and a fresh child record with their formal blocks, the parent's process entries and
 * checkout states), built from a synthetic materialization scenario with the fixture Engine: a real materialization, the real Phase D'
 * (Production Planner, independent Trace Replay) in a first and a fresh "process". The registered expectation is the fixture's own (the
 * fixture conditions, the scene's CalculationContext, the registered envelope), never the real registration's materialization values.
 * The semantic hash is the caller's: a script test passes SHA-256 (the runner's rule); `src` imports no Node module, so the default is a
 * deterministic 64-hex stand-in built from the domain's stable hash.
 */

/** A deterministic 64 lower-case hex stand-in for SHA-256 in `src` tests (never a real digest). */
export const fixtureHex64 = (text: string) => hashStableValue(text).slice('fnv1a32:'.length).repeat(8)

export const D1C_FIXTURE_HEAD = 'a'.repeat(40)
export const D1C_FIXTURE_EXPORT = { fileName: 'fixture-export.json', bytes: 10, sha256: 'e'.repeat(64) }
export const D1C_FIXTURE_PARENT_PID = 100
const RESEARCH_MAX_PLAN_STEPS = 1_000
const SPEC = {
  targets: ['a', 'b'] as ('a' | 'b')[],
  owned: [ownedGogma('owned.g1', { seriesSkillId: 'series_skill.fixture.a' })],
  skillIdeal: { [ELEMENT_B]: [7] },
  reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
  window: { skill: 3, gogma: 5, normal: 2 },
}

/** A mutable plain-data child record (as JSON-parsed from a file). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FixtureRecord = Record<string, any>

export interface D1cFixtureSide {
  process: D1cProcessEntry
  /** The record as the file holds it (null: the child wrote none). */
  record: FixtureRecord | null
  /** Set to make the file unreadable (the runner's readChild() then reads no record). */
  readError: string | null
}

export interface D1cFixtureRun {
  runIndex: number
  first: D1cFixtureSide
  fresh: D1cFixtureSide | null
  checkoutBefore: D1aCheckoutState
  checkoutAfter: D1aCheckoutState
  entrySet: unknown
}

export interface D1cFixtureParts {
  start: D1cStartRecord
  startRecordMatches: boolean
  runs: D1cFixtureRun[]
}

export interface D1cFixture {
  expectation: D1cRegisteredExpectation
  hash: (text: string) => string
  /** The registered D-0C identity of the fixture (its own materialization, read from its synthetic D-1B document block). */
  registeredD0c: { semanticSha256: string; entryFingerprint: string }
  /** A fresh deep copy of an intact measurement (two complete runs, every rule satisfied). */
  parts(): D1cFixtureParts
  /** The observations the runner would conclude from (its readChild() rule over the records, re-hashing with `hash`). */
  observe(parts: D1cFixtureParts): D1cMeasurementObservation
  /** The raw sources the derivation script reads (the runner's raw RESULT with its conclusion, the start record text, the readings). */
  sources(parts: D1cFixtureParts): D1cPublicResultSources
}

const CHECKOUT: D1aCheckoutState = { repositoryHeadSha: D1C_FIXTURE_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false }

export async function d1cFixture(options: { hash?: (text: string) => string } = {}): Promise<D1cFixture> {
  const hash = options.hash ?? fixtureHex64
  const conditions = d0cFixtureConditions({ projectedSearchScaleGate: OPEN_GATE })
  const scene = await materializationScenario(SPEC)
  let tick = 0
  const now = () => (tick += 1)
  const handoffs: MaterializedEntriesHandoff[] = []
  const materialization = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now, onMaterializedEntries: handoff => { handoffs.push(handoff) } })
  const semanticSha256 = hash(JSON.stringify(materialization.semantic))
  const registeredD0c = { semanticSha256, entryFingerprint: materializedEntriesFingerprintOfSemantic(materialization.semantic)! }
  const identity = compareD0cMaterializationIdentity({ semantic: materialization.semantic, semanticSha256, handoffs, expected: registeredD0c })
  const handoff = handoffs[0]!
  const calculationContext = { ...scene.input.calculationContext }
  const rngEngineVersion = calculationContext.rngEngineVersion
  const first = await verifyPlannerCandidate(scene.input, handoff, globalResearchDependencies(scene.engine), { researchMaxPlanSteps: RESEARCH_MAX_PLAN_STEPS }, { now })
  const entrySet = JSON.parse(JSON.stringify(createD1aEntrySet(handoff, { repositoryHeadSha: D1C_FIXTURE_HEAD, export: D1C_FIXTURE_EXPORT, calculationContext, rngEngineVersion })))
  const freshScene = await materializationScenario(SPEC)
  const fresh = await verifyPlannerCandidate(freshScene.input, handoffFromEntrySet(entrySet, handoff.planningTargetIds), globalResearchDependencies(freshScene.engine), { researchMaxPlanSteps: RESEARCH_MAX_PLAN_STEPS }, { now })

  const registered = registeredD1cExpectation()
  const expectation: D1cRegisteredExpectation = {
    ...registered,
    conditions: { materialization: conditions, verification: { researchMaxPlanSteps: RESEARCH_MAX_PLAN_STEPS, verificationBudget: 1 }, envelope: { ...registered.conditions.envelope } },
    calculationContext,
  }
  const heapFlag = `--max-old-space-size=${expectation.conditions.envelope.childHeapMb}`
  const fingerprint = d1cRegistrationFingerprint()
  const d1bDocument = (source: string) => ({
    source, error: null,
    text: [`registered-d1c-registration-fingerprint: ${fingerprint}`, `registered-d0c-materialization-semantic-sha256: ${registeredD0c.semanticSha256}`, `registered-d0c-entry-fingerprint: ${registeredD0c.entryFingerprint}`].join('\n'),
  })
  const documents = { atMeasuredHead: d1bDocument('HEAD:docs/d1b.md'), atRegistrationHead: d1bDocument(`${expectation.registrationHead}:docs/d1b.md`) }
  const registration = observeD1cRegistration(documents)
  const registeredD0cObservation = observeD1cRegisteredD0c(documents)
  const registeredExport = observeD1cRegisteredExport({
    source: 'HEAD:docs/d0b2.md', error: null,
    text: [`registered-export-file: ${D1C_FIXTURE_EXPORT.fileName}`, `registered-export-bytes: ${D1C_FIXTURE_EXPORT.bytes}`, `registered-export-sha256: ${D1C_FIXTURE_EXPORT.sha256}`].join('\n'),
  })
  const calculationAudit: D1cCalculationCodeAudit = { registrationHead: expectation.registrationHead, registrationHeadIsAncestor: true, changedFiles: ['src/benchmarks/globalAssignment/verificationFormal.ts'], error: null }
  const flags = ['--mode', '--export', '--run-dir', '--output']
  const inputsRead = [`export:${D1C_FIXTURE_EXPORT.fileName}`, 'git:HEAD:docs/d1b.md', `git:${expectation.registrationHead}:docs/d1b.md`, 'git:HEAD:docs/d0b2.md']
  const currentAuthorities = { calculationContext, rngEngineVersion }
  const startGate = d1cFormalStartGate({
    registration, flags, mode: 'formal', checkout: { headSha: D1C_FIXTURE_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit },
    registeredExport, actualExport: D1C_FIXTURE_EXPORT, registeredD0c: registeredD0cObservation,
    outputPaths: [{ option: '--run-dir', path: '.local/fixture.run', gitIgnored: true, exists: false }, { option: '--output', path: '.local/fixture.json', gitIgnored: true, exists: false }],
    currentAuthorities, plannedConditions: expectation.conditions, inputsRead,
  }, expectation)
  const start: D1cStartRecord = {
    formalProtocolVersion: D1C_FORMAL_PROTOCOL_VERSION, phase: PLANNER_VERIFICATION_D1C_PHASE, mode: 'formal', nature: 'fixture formal measurement',
    measurementHeadSha: D1C_FIXTURE_HEAD, registrationHead: expectation.registrationHead, benchmarkCodeSha256: 'b'.repeat(64), workingTreeClean: true, uncommittedBenchmarkCode: false,
    flags, modeOption: 'formal', parentPid: D1C_FIXTURE_PARENT_PID, registration, calculationAudit, registeredExport, actualExport: { ...D1C_FIXTURE_EXPORT }, registeredD0c: registeredD0cObservation,
    documents: [{ source: 'HEAD:docs/d1b.md', sha256: 'c'.repeat(64), error: null }], currentAuthorities, conditions: structuredClone(expectation.conditions), inputsRead,
    oracleFreeExecution: true, oracleInformedDesign: true, startGate, verificationProtocolVersion: expectation.verificationProtocolVersion,
    materializationProtocolVersion: expectation.materializationProtocolVersion, plannerInputMaxPlanStepsForValidationOnly: 1_000, runnerScript: 'scripts/run-planner-global-assignment-d1c.mjs',
    node: 'v0.fixture', v8: '0', launchedAt: '2026-01-01T00:00:00.000Z', machine: { cpuModel: 'fixture' },
  }

  const gate = () => ({
    issues: [], observedHeadSha: D1C_FIXTURE_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, calculationAudit, registration, registeredExport,
    registeredD0c: registeredD0cObservation, execArgv: [heapFlag],
  })
  const pidOf = (runIndex: number, role: D1cRole) => D1C_FIXTURE_PARENT_PID + runIndex * 10 + (role === 'first' ? 1 : 2)
  const processOf = (runIndex: number, role: D1cRole): D1cProcessEntry => {
    const order = (runIndex - 1) * 2 + (role === 'first' ? 0 : 1)
    return {
      id: `run-${runIndex}-${role}`, role, runIndex, outcome: 'completed', exitCode: 0, signal: null, timedOut: false, cancelled: false, settledBy: 'close', spawnError: null,
      pid: pidOf(runIndex, role), wallMs: role === 'first' ? expectation.conditions.envelope.firstChildWallMs : expectation.conditions.envelope.freshChildWallMs,
      heapMb: expectation.conditions.envelope.childHeapMb, nodeFlags: [heapFlag], startedAtMs: order * 100, endedAtMs: order * 100 + 50, wallObservedMs: 50, recordWritten: true, recordFile: `${role}.record.json`,
    }
  }
  const base = (role: D1cRole) => ({
    role, protocolVersion: expectation.verificationProtocolVersion, repositoryHeadSha: D1C_FIXTURE_HEAD, childCheckout: CHECKOUT, exportVerification: { actual: { ...D1C_FIXTURE_EXPORT }, taskMatched: true },
    rngEngineVersion, calculationContext, node: 'v0.fixture', execArgv: [heapFlag],
  })
  const formal = (role: D1cRole, runIndex: number, fields: object) => ({
    mode: 'formal', formalProtocolVersion: D1C_FORMAL_PROTOCOL_VERSION, role, runIndex, pid: pidOf(runIndex, role), gate: gate(),
    calculation: { issues: [], calculationContext, rngEngineVersion }, entrySetSource: null, verificationBudget: null, verifiedCandidates: null,
    inputsRead: [`task:${role}.task.json`, ...inputsRead], ...fields,
  })
  const entrySetText = JSON.stringify(entrySet) + '\n'
  const intact: D1cFixtureParts = {
    start, startRecordMatches: true,
    runs: [1, 2].map(runIndex => ({
      runIndex,
      first: {
        process: processOf(runIndex, 'first'), readError: null,
        record: {
          ...base('first'), formal: formal('first', runIndex, { verificationBudget: 1, verifiedCandidates: 1 }),
          materialization: { semanticSha256, semantic: materialization.semantic, observed: materialization.observed, wallMs: 30 },
          identity, entrySet: { file: 'first.entry-set.json', bytes: entrySetText.length, sha256: hash(entrySetText), entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length },
          phase0PlanningTargetIds: [...handoff.planningTargetIds].sort(), verification: { ...first, semanticSha256: hash(JSON.stringify(first.semantic)) },
          observed: { setupMs: 1, wallMs: 40, eventLoopYields: 2 }, memory: { maxima: { heapUsed: 100, heapTotal: 200, rss: 300, external: 4, samples: 5 }, heapSizeLimit: 4_000, maxRssKiB: 900, stages: [{ heapUsed: 90, rss: 280 }] },
        },
      },
      fresh: {
        process: processOf(runIndex, 'fresh'), readError: null,
        record: {
          ...base('fresh'), formal: formal('fresh', runIndex, { entrySetSource: { issues: [] } }),
          entrySet: { file: 'first.entry-set.json', sha256: hash(entrySetText), entryFingerprint: entrySet.entryFingerprint, entryCount: entrySet.materializedEntries.length, issues: [] },
          phase0PlanningTargetIds: [...handoff.planningTargetIds].sort(), verification: { ...fresh, semanticSha256: hash(JSON.stringify(fresh.semantic)) },
          observed: { setupMs: 1, wallMs: 9, eventLoopYields: 1 }, memory: { maxima: { heapUsed: 50, heapTotal: 80, rss: 120, external: 2, samples: 3 }, heapSizeLimit: 4_000, maxRssKiB: 400, stages: [] },
        },
      },
      checkoutBefore: { ...CHECKOUT }, checkoutAfter: { ...CHECKOUT }, entrySet,
    })),
  }
  const serialized = JSON.stringify(intact)

  const readingOf = (side: D1cFixtureSide): D1aChildReading => {
    const reading: D1aChildReading = { process: side.process.outcome, record: null, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } }
    if (side.process.outcome !== 'completed' || side.process.recordFile === null || side.record === null) return reading
    if (side.readError !== null) return { ...reading, readError: side.readError }
    reading.record = JSON.parse(JSON.stringify(side.record))
    const record = reading.record as FixtureRecord
    if (record.materialization?.semantic !== undefined) reading.recomputed.materializationSha256 = hash(JSON.stringify(record.materialization.semantic))
    if (record.verification?.semantic !== undefined) reading.recomputed.verificationSha256 = hash(JSON.stringify(record.verification.semantic))
    return reading
  }
  const observe = (parts: D1cFixtureParts): D1cMeasurementObservation => ({
    start: parts.start, startRecordMatches: parts.startRecordMatches,
    runs: parts.runs.map(run => ({
      runIndex: run.runIndex, first: { process: run.first.process, reading: readingOf(run.first) },
      fresh: run.fresh === null ? null : { process: run.fresh.process, reading: readingOf(run.fresh) }, checkoutBefore: run.checkoutBefore, checkoutAfter: run.checkoutAfter,
    })),
  })
  const sources = (parts: D1cFixtureParts): D1cPublicResultSources => {
    const observation = observe(parts)
    const conclusion = concludeD1cMeasurement(observation, expectation)
    const rawSide = (run: (typeof observation.runs)[number]['first']) => ({ process: run.process, readError: run.reading.readError, recomputed: run.reading.recomputed, confirmedProgress: null, stderrTail: null })
    const output: D1cRawOutput = {
      resultKind: 'global-assignment-d1c-raw-result', formalProtocolVersion: D1C_FORMAL_PROTOCOL_VERSION, status: 'formal', runDir: 'fixture.run', start: parts.start,
      startRecordMatches: parts.startRecordMatches, cancelled: false,
      runs: observation.runs.map((run, index) => ({ runIndex: run.runIndex, dir: `run-${run.runIndex}`, first: rawSide(run.first), fresh: run.fresh === null ? null : rawSide(run.fresh), checkoutBefore: parts.runs[index]!.checkoutBefore, checkoutAfter: parts.runs[index]!.checkoutAfter })),
      conclusion, totalWallMs: 400, claims: 'fixture',
    }
    return {
      output, startRecordText: parts.startRecordMatches ? JSON.stringify(parts.start, null, 2) + '\n' : '{}\n',
      children: observation.runs.flatMap((run, index) => [
        { runIndex: run.runIndex, role: 'first' as const, reading: run.first.reading, entrySet: parts.runs[index]!.entrySet },
        ...(run.fresh === null ? [] : [{ runIndex: run.runIndex, role: 'fresh' as const, reading: run.fresh.reading, entrySet: null }]),
      ]),
      files: [{ file: 'fixture.json', bytes: 1, sha256: 'd'.repeat(64) }],
    }
  }
  return { expectation, hash, registeredD0c, parts: () => JSON.parse(serialized) as D1cFixtureParts, observe, sources }
}
