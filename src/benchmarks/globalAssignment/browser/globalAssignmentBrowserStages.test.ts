import { describe, expect, it } from 'vitest'
import type { RngEngine } from '../../../domain/rng/rngEngine'
import { webCryptoSha256 } from '../../plannerGlobalBrowserEvidence'
import { registeredD1cConditions } from '../verificationRegistration'
import { materializedEntriesFingerprintOfSemantic } from '../verificationProtocol'
import { judgeBrowserLogicalRun } from './globalAssignmentBrowserJudgement'
import type { GabProgressEvent } from './globalAssignmentBrowserProtocol'
import {
  decodeExportText, GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS, GlobalAssignmentBrowserStageCancelled, GlobalAssignmentBrowserStageError, runFirstStage, runFreshStage,
  type GlobalAssignmentStageResult,
} from './globalAssignmentBrowserStages'
import {
  d1aReferenceRun, scenarioEngineFactory, SYNTHETIC_CONDITIONS, SYNTHETIC_SPEC, syntheticBuildInput, syntheticExport, syntheticPorts, syntheticProvenance, type SyntheticExport,
} from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1: the environment-neutral stage module runs exactly the D-1A child calculation sequence. On synthetic
 * scenarios (a table Engine, no real Export) its semantic records and SHA-256 equal those of the D-1A call sequence written out
 * directly, its Engines and dependencies are built in the D-1A order, the input keeps the validation-only maxPlanSteps while Phase D'
 * uses the Research one, and every typed outcome passes through unchanged.
 */

const json = (value: unknown) => JSON.stringify(value)

async function firstAndFresh(source: SyntheticExport, conditions = SYNTHETIC_CONDITIONS) {
  const first = await runFirstStage(conditions, syntheticProvenance(source), syntheticPorts(source))
  const fresh = await runFreshStage(JSON.parse(JSON.stringify(first.entrySet!.value)), conditions, syntheticProvenance(source), syntheticPorts(source))
  return { first, fresh }
}

const viewOf = (result: GlobalAssignmentStageResult) => result.verification === null ? null : { semantic: result.verification.semantic, semanticSha256: result.verification.semanticSha256 }

describe('P-1 stage module: the D-1A calculation sequence', () => {
  it('gives the D-1A child call sequence\'s semantic records and SHA-256, byte for byte, for first and fresh', async () => {
    const source = await syntheticExport()
    const reference = await d1aReferenceRun(source, SYNTHETIC_CONDITIONS)
    const { first, fresh } = await firstAndFresh(source)
    expect(json(first.materialization!.semantic)).toBe(json(reference.first.materialization))
    expect(first.materialization!.semanticSha256).toBe(reference.first.materializationSha256)
    expect(first.materialization!.semanticSha256).toBe(await webCryptoSha256(json(first.materialization!.semantic)))
    expect(json(first.entrySet!.value)).toBe(json(reference.first.entrySet))
    expect(first.entrySet!.entryFingerprint).toBe(reference.first.entrySet.entryFingerprint)
    expect(first.entrySet!.entryFingerprint).toBe(materializedEntriesFingerprintOfSemantic(first.materialization!.semantic))
    expect(json(first.verification!.semantic)).toBe(json(reference.first.verification))
    expect(first.verification!.semanticSha256).toBe(reference.first.verificationSha256)
    expect(json(fresh.verification!.semantic)).toBe(json(reference.fresh.verification))
    expect(fresh.verification!.semanticSha256).toBe(reference.fresh.verificationSha256)
    expect(fresh.phase0.planningTargetIdsSorted).toEqual(reference.fresh.phase0PlanningTargetIdsSorted)
    // As in D-1A, the first and the fresh Phase D' agree, and the run meets every condition (non-formal label only).
    expect(first.verification!.semantic.outcome).toEqual({ kind: 'conditions_met' })
    expect(first.verification!.semanticSha256).toBe(fresh.verification!.semanticSha256)
    const judgement = judgeBrowserLogicalRun(
      { settle: 'completed', stoppedBeforeRequest: null, materializationOutcome: first.materialization!.semantic.outcome, verification: viewOf(first) },
      { settle: 'completed', phase0PlanningTargetIds: fresh.phase0.planningTargetIdsSorted, verification: viewOf(fresh) }, [], { cancelled: false },
    )
    expect(judgement.verdict).toEqual({ kind: 'browser_nonformal_conditions_met', physicalOperations: reference.first.handoffs[0]!.objective, planSteps: reference.first.handoffs[0]!.objective,
      objective: reference.first.handoffs[0]!.objective, planningTargetCount: 2, fullPlannerRuns: { first: 1, fresh: 1 } })
    expect(judgement.recordClassification).toBe('browser_nonformal_conditions_met')
    expect(judgement).toMatchObject({ formal: false, formalValidity: 'not_claimed', acceptance: 'not_claimed', minimality: 'not_claimed' })
  }, 120_000)

  it('is deterministic across stage runs and independent of the clock and the yield', async () => {
    const source = await syntheticExport()
    const once = await firstAndFresh(source)
    let slow = 0
    const twice = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { now: () => (slow += 37), yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) }))
    expect(twice.materialization!.semanticSha256).toBe(once.first.materialization!.semanticSha256)
    expect(twice.verification!.semanticSha256).toBe(once.first.verification!.semanticSha256)
    expect(json(twice.entrySet!.value)).toBe(json(once.first.entrySet!.value))
    expect(twice.timing.stageTotalMs).not.toBe(once.first.timing.stageTotalMs)
  }, 120_000)

  it('builds the Engines and dependencies in the D-1A order: input, materialization Engine, then a new Engine for Phase D\'', async () => {
    const source = await syntheticExport()
    const base = scenarioEngineFactory(SYNTHETIC_SPEC)
    const log: string[] = []
    const engines: { label: string; engine: RngEngine; predictions: () => number }[] = []
    const createEngine = () => {
      const engine = base()
      let predictions = 0
      const counted: RngEngine = {
        ...engine, version: engine.version, capabilities: engine.capabilities,
        predictGogmaBonus: input => { predictions += 1; return engine.predictGogmaBonus(input) },
        predictSkills: input => { predictions += 1; return engine.predictSkills(input) },
        predictNormalArtian: input => { predictions += 1; return engine.predictNormalArtian(input) },
      }
      const label = `engine${engines.length + 1}`
      engines.push({ label, engine: counted, predictions: () => predictions })
      log.push(label)
      return counted
    }
    const onEvent = (event: GabProgressEvent) => {
      if (event.kind === 'input' && event.status === 'finished') log.push(`input:${event.stage}`)
      if (event.kind === 'materialization' && (event.event.kind === 'context' || event.event.kind === 'candidate_settled')) log.push(`materialization:${event.event.kind}`)
      if (event.kind === 'verification' && event.event.stage === 'handoff' && event.event.status === 'started') log.push(`verification:predictions:${engines.map(entry => entry.predictions()).join('/')}`)
    }
    const buildInput = (value: unknown) => { log.push('buildInput'); return syntheticBuildInput(value) }
    const first = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { createEngine, onEvent, buildInput }))
    expect(log.slice(0, 8)).toEqual(['input:export_read', 'input:export_hash', 'input:utf8_decode', 'input:json_parse', 'buildInput', 'input:input_build', 'engine1', 'materialization:context'])
    expect(log.indexOf('engine2')).toBeGreaterThan(log.indexOf('materialization:candidate_settled'))
    // The materialization predicted on engine1 only; Phase D' started before engine2 had predicted anything, and then used engine2 alone.
    const atHandoff = log.find(line => line.startsWith('verification:predictions:'))!
    expect(atHandoff).toMatch(/^verification:predictions:[1-9][0-9]*\/0$/)
    expect(engines).toHaveLength(2)
    expect(engines[1]!.predictions()).toBeGreaterThan(0)
    expect(first.rngEngineVersion).toBe(engines[0]!.engine.version)
    // fresh: its own input, an Engine for its own Phase 0, a new Engine for Phase D'.
    log.length = 0
    engines.length = 0
    await runFreshStage(first.entrySet!.value, SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { createEngine, onEvent, buildInput }))
    expect(log.slice(0, 9)).toEqual(['input:export_read', 'input:export_hash', 'input:utf8_decode', 'input:json_parse', 'buildInput', 'input:input_build', 'engine1', 'input:phase0', 'engine2'])
    expect(engines).toHaveLength(2)
  }, 120_000)

  it('keeps the validation-only maxPlanSteps in the PlannerInput and gives Phase D\' the Research maxPlanSteps of the conditions', async () => {
    const source = await syntheticExport()
    const { first, fresh } = await firstAndFresh(source)
    expect(GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS).toBe(1_000)
    for (const result of [first, fresh]) {
      expect(result.plannerInputMaxPlanStepsForValidationOnly).toBe(1_000)
      expect(result.conditions.researchMaxPlanSteps).toBe(20_000)
      expect(result.verification!.semantic.conditions).toEqual({ researchMaxPlanSteps: 20_000 })
      expect(result.verification!.semantic.finalInput!.maxPlanSteps).toBe(20_000)
      expect(result.verification!.semantic.planner!.termination!.limits).toEqual({ maxPlanSteps: 20_000 })
    }
  }, 120_000)

  it('takes the conditions only from its caller: the registered D-1C conditions reach the record unchanged', async () => {
    const registered = registeredD1cConditions()
    // A synthetic input with no Build List stops at Phase 0, so the registered window never scans a table Engine.
    const source = await syntheticExport(SYNTHETIC_SPEC, input => ({ ...input, buildListEntries: [] }))
    const first = await runFirstStage({ materialization: registered.materialization, verification: registered.verification }, syntheticProvenance(source), syntheticPorts(source))
    expect(first.conditions).toEqual({ materialization: registered.materialization, researchMaxPlanSteps: registered.verification.researchMaxPlanSteps, verificationBudget: registered.verification.verificationBudget })
    expect(first.materialization!.semantic.conditions).toEqual(registered.materialization)
    expect(first.conditions.researchMaxPlanSteps).toBe(20_000)
    expect(first.conditions.verificationBudget).toBe(1)
  }, 60_000)

  it('hashes the Export bytes before decoding and decodes them as Node Buffer.toString(\'utf8\') does', async () => {
    const source = await syntheticExport()
    const seen: ArrayBuffer[] = []
    const first = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { sha256Bytes: async bytes => { seen.push(bytes); return source.identity.sha256 } }))
    expect(seen).toHaveLength(1)
    expect(seen[0]!.byteLength).toBe(source.identity.bytes)
    expect(first.exportObservation).toEqual({ ...source.identity, matchesRequest: true })
    const nodeBuffer = (globalThis as unknown as { Buffer: { from(value: Uint8Array): { toString(encoding: string): string } } }).Buffer
    const samples = [
      Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), // a BOM-led "{}" (kept, so JSON.parse fails alike)
      Uint8Array.of(0x7b, 0xff, 0xfe, 0x7d), // invalid bytes (U+FFFD each)
      Uint8Array.of(0xe3, 0x81, 0x82, 0xe3), // a truncated sequence at the end
      new TextEncoder().encode('{"日本語":"テスト"}'),
    ]
    for (const sample of samples) expect(decodeExportText(sample.buffer.slice(0) as ArrayBuffer)).toBe(nodeBuffer.from(sample).toString('utf8'))
    expect(decodeExportText(samples[0]!.buffer.slice(0) as ArrayBuffer).charCodeAt(0)).toBe(0xfeff)
  }, 60_000)
})

describe('P-1 stage module: typed outcomes pass through unchanged', () => {
  it('stops before Phase D\' without a handoff: Phase 0 unsupported_input keeps its outcome, no Entry set, no verification', async () => {
    const source = await syntheticExport(SYNTHETIC_SPEC, input => ({ ...input, buildListEntries: [] }))
    const first = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source))
    expect(first.materialization!.semantic.outcome).toEqual({ kind: 'unsupported_input', stage: 'context', reason: 'no_planning_target' })
    expect(first.materialization!.handoffCount).toBe(0)
    expect(first).toMatchObject({ entrySet: null, verification: null, integrityIssues: [], phase0: { planningTargetCount: 0, planningTargetIdsSorted: null } })
    const judgement = judgeBrowserLogicalRun({ settle: 'completed', stoppedBeforeRequest: null, materializationOutcome: first.materialization!.semantic.outcome, verification: null }, { settle: 'not_run', phase0PlanningTargetIds: null, verification: null }, [], { cancelled: false })
    expect(judgement.verdict).toEqual({ kind: 'phase_d_prime_not_reached', run: 'first', materializationOutcome: { kind: 'unsupported_input', stage: 'context', reason: 'no_planning_target' } })
    expect(judgement.recordClassification).toBe('browser_nonformal_phase_d_prime_not_reached')
  }, 60_000)

  it('keeps a Planner rejection a Planner rejection (a truncated Research maxPlanSteps), with the Entry set still handed over', async () => {
    const source = await syntheticExport()
    const conditions = { ...SYNTHETIC_CONDITIONS, verification: { researchMaxPlanSteps: 1, verificationBudget: 1 } }
    const { first, fresh } = await firstAndFresh(source, conditions)
    expect(first.verification!.semantic.outcome).toMatchObject({ kind: 'planner_rejected', reasons: expect.arrayContaining([{ code: 'max_plan_steps_reached', maxPlanSteps: 1 }]) })
    expect(first.entrySet).not.toBeNull()
    const judgement = judgeBrowserLogicalRun(
      { settle: 'completed', stoppedBeforeRequest: null, materializationOutcome: first.materialization!.semantic.outcome, verification: viewOf(first) },
      { settle: 'completed', phase0PlanningTargetIds: fresh.phase0.planningTargetIdsSorted, verification: viewOf(fresh) }, [], { cancelled: false },
    )
    expect(judgement.verdict).toMatchObject({ kind: 'planner_rejected', run: 'first' })
  }, 120_000)

  it('records a cancel at an existing cancel point as the typed outcome (scan_cancelled, the Planner\'s unmeasured) and stops at stage boundaries', async () => {
    const source = await syntheticExport()
    // Cancel once Phase 0 settled: Phase A's first checkpoint stops the scan (typed scan_cancelled, no handoff, no Phase D').
    let afterContext = false
    const scan = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, {
      shouldCancel: () => afterContext, onEvent: event => { if (event.kind === 'materialization' && event.event.kind === 'context') afterContext = true },
    }))
    expect(scan.materialization!.semantic.outcome).toEqual({ kind: 'scan_cancelled' })
    expect(scan.verification).toBeNull()
    // Cancel once the Planner started: Phase D' reports its own unmeasured(cancelled), never a Planner result.
    let inPlanner = false
    const fresh = await runFreshStage((await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source))).entrySet!.value, SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, {
      shouldCancel: () => inPlanner, onEvent: event => { if (event.kind === 'verification' && event.event.stage === 'planner' && event.event.status === 'started') inPlanner = true },
    }))
    expect(fresh.verification!.semantic.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
    // A flag already set at a stage boundary stops the stage there (best effort; the main thread decides adoption).
    await expect(runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { shouldCancel: () => true }))).rejects.toBeInstanceOf(GlobalAssignmentBrowserStageCancelled)
  }, 120_000)

  it('refuses a changed Export, an unparsable or invalid input, another verification budget, a refused fresh Phase 0 and a broken Entry set before any calculation', async () => {
    const source = await syntheticExport()
    const refusal = async (promise: Promise<unknown>) => {
      const error = await promise.catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(GlobalAssignmentBrowserStageError)
      return error as GlobalAssignmentBrowserStageError
    }
    const otherSha = { ...syntheticProvenance(source), expectedExport: { ...source.identity, sha256: 'f'.repeat(64) } }
    expect(await refusal(runFirstStage(SYNTHETIC_CONDITIONS, otherSha, syntheticPorts(source)))).toMatchObject({ code: 'export_changed', stage: 'export_hash' })
    const garbage = new TextEncoder().encode('not json').buffer as ArrayBuffer
    const garbageSource = { ...source, bytes: garbage, identity: { ...source.identity, bytes: garbage.byteLength, sha256: await webCryptoSha256('not json') } }
    expect(await refusal(runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(garbageSource), syntheticPorts(garbageSource)))).toMatchObject({ code: 'input_build_failed', stage: 'json_parse' })
    expect(await refusal(runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source, { buildInput: () => { throw new Error('Export validation failed') } }))))
      .toMatchObject({ code: 'input_build_failed', stage: 'input_build', message: 'Error: Export validation failed' })
    expect(await refusal(runFirstStage({ ...SYNTHETIC_CONDITIONS, verification: { researchMaxPlanSteps: 20_000, verificationBudget: 2 } }, syntheticProvenance(source), syntheticPorts(source)))).toMatchObject({ code: 'condition_refused' })
    const first = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source))
    const noTargets = await syntheticExport(SYNTHETIC_SPEC, input => ({ ...input, buildListEntries: [] }))
    expect(await refusal(runFreshStage(first.entrySet!.value, SYNTHETIC_CONDITIONS, syntheticProvenance(noTargets), syntheticPorts(noTargets)))).toMatchObject({ code: 'fresh_phase0_refused', stage: 'phase0' })
    const tampered = structuredClone(first.entrySet!.value)
    tampered.materializedEntries[0]!.entry.targetDefinitionHash = 'fnv1a32:00000000'
    expect(await refusal(runFreshStage(tampered, SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source)))).toMatchObject({ code: 'entry_set_refused', stage: 'entry_set' })
    expect(await refusal(runFreshStage(first.entrySet!.value, SYNTHETIC_CONDITIONS, syntheticProvenance(source, 'd'.repeat(40)), syntheticPorts(source)))).toMatchObject({ code: 'entry_set_refused' })
    expect(await refusal(runFreshStage(null, SYNTHETIC_CONDITIONS, syntheticProvenance(source), syntheticPorts(source)))).toMatchObject({ code: 'entry_set_refused' })
  }, 120_000)

  it('verifies only the first handoff when the materialization hands over more than the verification budget, and records it as an integrity issue', async () => {
    const source = await syntheticExport()
    // A test-only candidate limit of 3: this scenario then materializes two structural candidates.
    const first = await runFirstStage({ ...SYNTHETIC_CONDITIONS, materialization: { ...SYNTHETIC_CONDITIONS.materialization, structuralCandidateLimit: 3 } }, syntheticProvenance(source), syntheticPorts(source))
    expect(first.materialization!.handoffCount).toBe(2)
    expect(first.materialization!.semantic.outcome).toEqual({ kind: 'structural_candidates_materialized', classifications: ['all_materialized', 'all_materialized'] })
    expect(first.integrityIssues).toEqual(['The materialization handed over 2 candidates for a verification budget of 1; only the first is verified.'])
    expect(first.verification!.semantic.candidate.candidateIndex).toBe(0)
    expect(first.entrySet!.value.candidate.candidateIndex).toBe(0)
    // Any integrity issue makes the logical run invalid_run_integrity, whatever the Planner met (never conditions met).
    const judgement = judgeBrowserLogicalRun({ settle: 'completed', stoppedBeforeRequest: null, materializationOutcome: first.materialization!.semantic.outcome, verification: viewOf(first) },
      { settle: 'completed', phase0PlanningTargetIds: first.phase0.planningTargetIdsSorted, verification: viewOf(first) }, first.integrityIssues, { cancelled: false })
    expect(judgement.verdict).toEqual({ kind: 'invalid_run_integrity', issues: first.integrityIssues })
  }, 120_000)
})
