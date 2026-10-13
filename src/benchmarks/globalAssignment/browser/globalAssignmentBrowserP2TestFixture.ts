/**
 * Test-only helpers of the Global Assignment Browser P-2 analysis (Issue #154): real logical run records of the synthetic scenario
 * (the runner, the harness and the real controller in this realm, with a benchmark build provenance), the Node reference written the
 * way the D-1A runner writes it (its output and first / fresh records, from the D-1A child call sequence), a D-1C-public-RESULT-shaped
 * reference of the same values, a measurement plan document, and the analysis sources. No real Export, no real Target or weapon ID.
 */
import type { GabRole } from './globalAssignmentBrowserProtocol'
import { createGlobalAssignmentBrowserHarness } from './globalAssignmentBrowserHarness'
import { GAB_MEASUREMENT_PLAN_BEGIN, GAB_MEASUREMENT_PLAN_END, type GabMeasurementPlan, type GabPlanSlot, type GabSlotRunOptions } from './globalAssignmentBrowserMeasurementPlan'
import { createGlobalAssignmentBrowserRunner, gabWebCryptoSha256Text, type GabLogicalRunRecord, type GabRunPurpose } from './globalAssignmentBrowserRunner'
import { d1aReferenceRun, InProcessWorker, SYNTHETIC_CONDITIONS, syntheticControllerOptions, syntheticExport, type SyntheticExport } from './globalAssignmentBrowserTestFixture'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION } from './globalAssignmentBrowserProtocol'
import type { GabAnalysisSources, GabSourceFile } from './globalAssignmentBrowserAnalysis'
import { materializedEntriesFingerprintOfSemantic } from '../verificationProtocol'
import { summarizeD0cMaterializationOutcome } from '../materializationFormal'
import type { MaterializationSemanticRecord } from '../materializationRunner'
import type { PlannerVerificationSemantic } from '../verify'

export const P2_HEAD = '1'.repeat(40)
export const P2_BUILD = Object.freeze({ commit: P2_HEAD, uncommittedBenchmarkCode: false, benchmarkCodeSha256: '2'.repeat(64), benchmarkCodePaths: ['src'] })
export const P2_PLAN_PATH = 'docs/P2_TEST_PLAN.md'
export const P2_D1C_PATH = 'docs/P2_TEST_D1C.json'
export const P2_ENVIRONMENT = 'pc-test'

/** The slot options every synthetic slot uses (array_buffer transport: the jsdom Blob is not structured-cloned here). */
export function p2SlotOptions(purpose: GabRunPurpose): GabSlotRunOptions {
  return {
    execution: { yieldMode: 'timer', heartbeatIntervalMs: 50, workerHeapSampling: purpose === 'memory' },
    envelope: { firstWallMs: 600_000, freshWallMs: 600_000, cancelGraceMs: 10_000, readyTimeoutMs: 10_000 },
    cancelTrigger: purpose === 'cancel' ? { role: 'first', onProgressKey: 'materialization:context', delayMs: 0 } : null,
    ping: purpose === 'responsiveness' ? { timeoutMs: 5_000 } : null,
    memory: purpose === 'memory' ? { gcWaitMs: 0 } : null,
    lateResponseWaitMs: 0,
    exportTransport: 'array_buffer',
  }
}

export function p2Slot(slotId: string, purpose: GabRunPurpose, order: number, extra: Partial<GabPlanSlot> = {}): GabPlanSlot {
  return { slotId, purpose, order, origin: purpose === 'memory' ? 'isolated' : 'non_isolated', options: p2SlotOptions(purpose), rerunSlotId: null, note: '', ...extra }
}

/** The default synthetic plan: pilot, timing, rerun, cancel (re-run by rerun.2), rerun.2, responsiveness, memory; and one unavailable phone. */
export function p2DefaultSlots(): GabPlanSlot[] {
  return [
    p2Slot('t.pilot.1', 'pilot', 1), p2Slot('t.timing.1', 'timing', 2), p2Slot('t.rerun.1', 'rerun', 3), p2Slot('t.cancel.1', 'cancel', 4, { rerunSlotId: 't.rerun.2' }),
    p2Slot('t.rerun.2', 'rerun', 5), p2Slot('t.responsiveness.1', 'responsiveness', 6), p2Slot('t.memory.1', 'memory', 7),
  ]
}

export interface P2World {
  synthetic: SyntheticExport
  calculationContext: GabMeasurementPlan['calculationContext']
  plan(slots?: GabPlanSlot[], edit?: (plan: GabMeasurementPlan) => void): GabMeasurementPlan
}

export async function p2World(): Promise<P2World> {
  const synthetic = await syntheticExport()
  const calculationContext = JSON.parse(new TextDecoder().decode(synthetic.bytes)).calculationContext
  return {
    synthetic, calculationContext,
    plan: (slots = p2DefaultSlots(), edit = () => undefined) => {
      const required = slots.filter(slot => slot.purpose === 'timing' || slot.purpose === 'rerun').length
      const plan: GabMeasurementPlan = {
        kind: 'global-assignment-browser-p2-measurement-plan', revision: 1, series: 'p2-test', protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, baseCommit: '3'.repeat(40),
        export: { ...synthetic.identity }, calculationContext: { ...calculationContext },
        conditions: { source: 'test_injected', registrationFingerprint: null, materialization: structuredClone(SYNTHETIC_CONDITIONS.materialization), verification: { ...SYNTHETIC_CONDITIONS.verification } },
        references: { d1cPublicResult: { path: P2_D1C_PATH, sha256: '0'.repeat(64) }, nodeReference: { runner: 'scripts/run-planner-global-assignment-d1a.mjs', runs: 1 } },
        environments: [
          { environmentId: P2_ENVIRONMENT, status: 'planned', unavailableReason: null, description: 'synthetic test environment', userAgentMustInclude: ['jsdom'], requiredComparisonRuns: required, slots },
          { environmentId: 'phone-test', status: 'not_available', unavailableReason: 'no device in the test', description: 'synthetic phone', userAgentMustInclude: [], requiredComparisonRuns: 0, slots: [] },
        ],
      }
      edit(plan)
      return plan
    },
  }
}

export function p2PlanDocument(plan: unknown): string {
  return ['# P-2 test plan', '', GAB_MEASUREMENT_PLAN_BEGIN, '```json', JSON.stringify(plan, null, 2), '```', GAB_MEASUREMENT_PLAN_END, ''].join('\n')
}

export async function p2SourceFile(file: string, text: string): Promise<GabSourceFile> {
  return { file, bytes: new TextEncoder().encode(text).length, sha256: await gabWebCryptoSha256Text(text), text }
}

/** How a run is recorded: the slot as the record says (planned, purpose, options may be edited), and whether its result is delayed (a cancel lands first). */
export interface P2RunSpec {
  slot: GabPlanSlot
  planned?: boolean
  purpose?: GabRunPurpose
  options?: GabSlotRunOptions
  /** Delays every `gab_result` by this many ms (the cancel trigger fires before the result arrives: C2). */
  delayResultMs?: number
  /** Changes what the Worker's controller does (e.g. another build). */
  controller?: Parameters<typeof syntheticControllerOptions>[1]
}

/**
 * Records logical runs of the synthetic scenario through the real runner / harness / controller (one runner per origin, a strictly
 * increasing clock), and returns each run's record and its raw file (the page's `exportJson()` of that run alone, as the driver saves it).
 */
export async function p2RecordRuns(world: P2World, specs: readonly P2RunSpec[], options: { build?: object; isolatedBuild?: object } = {}): Promise<{ records: GabLogicalRunRecord[]; raw: GabSourceFile[] }> {
  let tick = Date.parse('2026-10-14T00:00:00.000Z')
  const clock = () => new Date((tick += 1_000)).toISOString()
  const runners = new Map<boolean, { runner: ReturnType<typeof createGlobalAssignmentBrowserRunner>; setSpec: (spec: P2RunSpec) => void }>()
  const runnerFor = (isolated: boolean) => {
    const existing = runners.get(isolated)
    if (existing !== undefined) return existing
    let current: P2RunSpec | null = null
    const build = (isolated ? options.isolatedBuild : undefined) ?? options.build ?? P2_BUILD
    const runner = createGlobalAssignmentBrowserRunner({
      createHarness: () => createGlobalAssignmentBrowserHarness({
        createWorker: () => new InProcessWorker(
          syntheticControllerOptions(world.synthetic, { build: () => structuredClone(build), environmentOverrides: { isSecureContext: true, crossOriginIsolated: isolated }, ...(current?.controller ?? {}) }),
          message => (message.type === 'gab_result' ? current?.delayResultMs ?? 0 : 0),
        ),
      }),
      mainEnvironment: () => ({ isSecureContext: true, crossOriginIsolated: isolated, cryptoSubtle: true, build: structuredClone(build) }), canCloneBlob: () => false,
      visibilityState: () => 'visible', subscribeLifecycle: () => () => undefined, sleep: async () => undefined, clock,
    })
    const entry = { runner, setSpec: (spec: P2RunSpec) => { current = spec } }
    runners.set(isolated, entry)
    return entry
  }
  const records: GabLogicalRunRecord[] = []
  const raw: GabSourceFile[] = []
  for (const spec of specs) {
    const entry = runnerFor(spec.slot.origin === 'isolated')
    entry.setSpec(spec)
    const record = await entry.runner.runLogicalRun(
      { file: new File([world.synthetic.bytes.slice(0)], world.synthetic.identity.fileName, { type: 'application/json' }), identity: { ...world.synthetic.identity } },
      { slot: { slotId: spec.slot.slotId, purpose: spec.purpose ?? spec.slot.purpose, planned: spec.planned ?? true, note: null }, ...structuredClone(spec.options ?? spec.slot.options) },
    )
    records.push(record)
    const text = entry.runner.exportJson({ userAgent: navigator.userAgent, origin: spec.slot.origin })
    entry.runner.clear()
    raw.push(await p2SourceFile(`${String(records.length).padStart(2, '0')}-${spec.slot.slotId}.json`, text))
  }
  return { records, raw }
}

const sha = (value: unknown) => gabWebCryptoSha256Text(JSON.stringify(value))

/** The Node reference as the D-1A runner writes it (output + first / fresh record files), from the D-1A child call sequence. */
export async function p2NodeReference(world: P2World, edit: { output?: (output: Record<string, unknown>) => void; first?: (record: Record<string, unknown>) => void } = {}) {
  const run = await d1aReferenceRun(world.synthetic, SYNTHETIC_CONDITIONS, P2_HEAD)
  const firstRecord: Record<string, unknown> = {
    role: 'first', materialization: { semantic: run.first.materialization, semanticSha256: run.first.materializationSha256, wallMs: 3 },
    entrySet: { file: 'first.entry-set.json', entryFingerprint: run.first.entrySet.entryFingerprint, entryCount: run.first.entrySet.materializedEntries.length },
    phase0PlanningTargetIds: [...run.first.handoffs[0]!.planningTargetIds].sort(),
    verification: { semantic: run.first.verification, semanticSha256: run.first.verificationSha256, observed: { elapsedMs: { planner: 2 } } },
  }
  const freshRecord: Record<string, unknown> = {
    role: 'fresh', entrySet: { file: 'first.entry-set.json', entryFingerprint: run.first.entrySet.entryFingerprint, entryCount: run.first.entrySet.materializedEntries.length, issues: [] },
    phase0PlanningTargetIds: run.fresh.phase0PlanningTargetIdsSorted,
    verification: { semantic: run.fresh.verification, semanticSha256: run.fresh.verificationSha256, observed: { elapsedMs: { planner: 1 } } },
  }
  edit.first?.(firstRecord)
  const output: Record<string, unknown> = {
    repositoryHeadSha: P2_HEAD, workingTreeClean: true, uncommittedBenchmarkCode: false, node: 'v24.test',
    exportVerification: { actual: { ...world.synthetic.identity } }, calculationContext: { ...world.calculationContext },
    conditions: { materialization: structuredClone(SYNTHETIC_CONDITIONS.materialization), researchMaxPlanSteps: { value: SYNTHETIC_CONDITIONS.verification.researchMaxPlanSteps }, plannerInputMaxPlanStepsForValidationOnly: 1_000 },
    verdict: { kind: 'verified' }, integrityIssues: [],
    runs: [
      { id: 'first', process: { outcome: 'completed', wallObservedMs: 30 }, recordFile: 'first.record.json', materialization: { semanticSha256: run.first.materializationSha256 },
        entrySet: { entryFingerprint: run.first.entrySet.entryFingerprint }, verification: { semanticSha256: run.first.verificationSha256 } },
      { id: 'fresh', process: { outcome: 'completed', wallObservedMs: 8 }, recordFile: 'fresh.record.json', entrySet: { entryFingerprint: run.first.entrySet.entryFingerprint },
        verification: { semanticSha256: run.fresh.verificationSha256 } },
    ],
  }
  edit.output?.(output)
  return {
    run,
    sources: {
      output: await p2SourceFile('node.result.json', JSON.stringify(output, null, 2) + '\n'),
      first: await p2SourceFile('first.record.json', JSON.stringify(firstRecord, null, 2) + '\n'),
      fresh: await p2SourceFile('fresh.record.json', JSON.stringify(freshRecord, null, 2) + '\n'),
    } as NonNullable<GabAnalysisSources['node']>,
  }
}

/** The D-1C public RESULT summary of one process verification (the fields of `verificationSummary()` the analysis reads). */
export function p2D1cVerificationSummary(semantic: PlannerVerificationSemantic, semanticSha256: string) {
  const planner = semantic.planner
  const replay = semantic.traceReplay
  const physical = semantic.physical
  return {
    semanticSha256, protocolVersion: semantic.protocolVersion, outcome: { kind: semantic.outcome.kind, reasonCodes: [] },
    candidate: { ordinal: semantic.candidate.ordinal, objective: semantic.candidate.objective, planningTargetCount: semantic.candidate.planningTargetCount, materializedEntryCount: semantic.candidate.materializedEntryCount, stage: semantic.candidate.stage, entryFingerprint: semantic.candidate.entryFingerprint },
    planner: planner === null ? null : {
      fullPlannerRuns: planner.fullPlannerRuns, termination: planner.termination === null ? null : { ...planner.termination, reachedLimits: [...planner.termination.reachedLimits], limits: { ...planner.termination.limits } },
      planPresent: planner.planPresent, planSteps: planner.planSteps, planHash: planner.planHash, stepSemanticsHash: planner.stepSemanticsHash, selectedEntryCount: planner.selectedBuildListEntryIds.length,
      conflictCount: planner.conflicts.length, rejectedCount: planner.rejected.length, resourceConflictCount: planner.rejected.filter(entry => entry.reason === 'resource_conflict').length, warningCount: planner.warnings.length,
    },
    traceReplay: replay === null ? null : { ran: replay.ran, isValid: replay.isValid, drafts: { ...replay.drafts }, correspondence: replay.correspondence === null ? null : { mismatchCount: replay.correspondence.mismatches, counterPositionMismatchCount: replay.correspondence.counterPositionMismatches } },
    physical: physical === null ? null : { physicalOperations: physical.physicalOperations, planSteps: physical.planSteps, nonPhysicalStepCount: physical.nonPhysicalStepCount, streamAdvanceSum: physical.streamAdvanceSum, objective: physical.objective, executedHash: physical.executedHash },
  }
}

function d1cMaterializationSummary(semantic: MaterializationSemanticRecord, semanticSha256: string) {
  const outcome = summarizeD0cMaterializationOutcome({ measured: [semantic], unmeasuredProgress: null })
  const candidate = outcome.candidates[0]!
  return {
    semanticSha256, protocolVersion: semantic.protocolVersion, verdict: outcome.verdict, runOutcome: outcome.runOutcome, planningTargetCount: outcome.planningTargetCount,
    candidate: { ordinal: candidate.ordinal, objective: candidate.objective, targetCount: candidate.targetCount, classification: candidate.classification, materialized: candidate.materialized, notAttempted: candidate.notAttempted, materializedBy: { ...candidate.materializedBy }, independentStops: { ...candidate.independentStops } },
  }
}

/** A D-1C-public-RESULT-shaped reference of the Node reference's values (two runs, every process identical), editable before it is written. */
export async function p2D1cResult(world: P2World, node: Awaited<ReturnType<typeof p2NodeReference>>, edit: (result: Record<string, unknown>) => void = () => undefined): Promise<GabSourceFile & { commit: string; path: string }> {
  const run = node.run
  const fingerprint = run.first.entrySet.entryFingerprint
  const process = (role: GabRole) => ({
    role,
    materialization: role === 'first' ? d1cMaterializationSummary(run.first.materialization, run.first.materializationSha256) : null,
    identity: role === 'first' ? { matched: true, entryFingerprint: materializedEntriesFingerprintOfSemantic(run.first.materialization) } : null,
    entrySet: { entryFingerprint: fingerprint, entryCount: run.first.entrySet.materializedEntries.length },
    phase0PlanningTargetCount: role === 'first' ? run.first.handoffs[0]!.planningTargetIds.length : run.fresh.phase0PlanningTargetIdsSorted.length,
    verification: role === 'first' ? p2D1cVerificationSummary(run.first.verification, run.first.verificationSha256) : p2D1cVerificationSummary(run.fresh.verification, run.fresh.verificationSha256),
  })
  const result: Record<string, unknown> = {
    resultKind: 'global-assignment-d1c-public-result',
    formalValidity: { status: 'valid' }, candidateOutcome: { kind: 'verified' }, acceptance: { status: 'accepted' },
    provenance: { measurementHeadSha: '4'.repeat(40), plannerInputMaxPlanStepsForValidationOnly: 1_000 },
    exportVerification: { actual: { ...world.synthetic.identity } }, calculationContext: { ...world.calculationContext }, rngEngineVersion: world.calculationContext.rngEngineVersion,
    registration: { registeredConditions: { materialization: structuredClone(SYNTHETIC_CONDITIONS.materialization), verification: { ...SYNTHETIC_CONDITIONS.verification } } },
    determinism: { materializationIdentical: true, verificationIdentical: true, entryFingerprintIdentical: true },
    runs: [1, 2].map(runIndex => ({ runIndex, first: process('first'), fresh: process('fresh') })),
  }
  edit(result)
  const text = JSON.stringify(result, null, 2) + '\n'
  return { ...(await p2SourceFile(`${P2_HEAD}:${P2_D1C_PATH}`, text)), commit: P2_HEAD, path: P2_D1C_PATH }
}

/** Analysis sources over the given parts (the plan's D-1C SHA-256 set to the given reference's unless `keepPlanD1cSha`). */
export async function p2Sources(parts: {
  plan: GabMeasurementPlan; raw: GabSourceFile[]; node: Awaited<ReturnType<typeof p2NodeReference>> | null; d1c: GabSourceFile & { commit: string; path: string }
  driver?: GabSourceFile | null; keepPlanD1cSha?: boolean; planCommit?: string
}): Promise<GabAnalysisSources> {
  const plan = structuredClone(parts.plan)
  if (parts.keepPlanD1cSha !== true) plan.references.d1cPublicResult.sha256 = parts.d1c.sha256
  const planText = p2PlanDocument(plan)
  return {
    measurementHead: P2_HEAD,
    plan: { ...(await p2SourceFile(`${parts.planCommit ?? P2_HEAD}:${P2_PLAN_PATH}`, planText)), commit: parts.planCommit ?? P2_HEAD, path: P2_PLAN_PATH },
    d1cResult: parts.d1c, browserRaw: parts.raw, driver: parts.driver ?? null, node: parts.node?.sources ?? null,
    registered: { source: 'test_injected', materialization: structuredClone(SYNTHETIC_CONDITIONS.materialization), verification: { ...SYNTHETIC_CONDITIONS.verification }, fingerprint: null },
  }
}

export const p2Ports = { sha256Text: gabWebCryptoSha256Text }
export { sha as p2Sha }
