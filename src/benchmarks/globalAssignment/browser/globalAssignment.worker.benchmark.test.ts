import { describe, expect, it } from 'vitest'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../../domain/rng/production/productionRngEngine'
import { webCryptoSha256 } from '../../plannerGlobalBrowserEvidence'
import { registeredD1cConditions } from '../verificationRegistration'
import { attachGlobalAssignmentBrowserWorker, createGlobalAssignmentBrowserController, gabSliceStageAfter, type GlobalAssignmentBrowserControllerOptions } from './globalAssignment.worker.benchmark'
import { GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, type GabResponse, type GabRunRequest, type GabWorkerResult } from './globalAssignmentBrowserProtocol'
import { runFirstStage } from './globalAssignmentBrowserStages'
import {
  bytesOf, minimalSyntheticExportRoot, SYNTHETIC_CONDITIONS, SYNTHETIC_EXECUTION, syntheticControllerOptions, syntheticExport, syntheticPorts, syntheticProvenance, type SyntheticExport,
} from './globalAssignmentBrowserTestFixture'
import { globalAssignmentBrowserWorkerOptions } from './globalAssignmentBrowserWorkerOptions'

/*
 * Issue #154 Production準備 P-1: the Worker controller. One Worker accepts one run, refuses a malformed / foreign-version / repeated
 * request before any calculation, reads its conditions itself, relays progress and heartbeats, acknowledges a cancel at once, stops at a
 * cancel point or just before posting its result (best effort), and sends exactly one terminal message per request.
 */

const V = GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
const TERMINAL = new Set(['gab_result', 'gab_cancelled', 'gab_error'])

function controllerOf(options: GlobalAssignmentBrowserControllerOptions) {
  const messages: GabResponse[] = []
  const controller = createGlobalAssignmentBrowserController(message => messages.push(structuredClone(message)), options)
  return { controller, messages }
}

function runRequest(source: { bytes: ArrayBuffer; identity: SyntheticExport['identity'] }, overrides: Partial<GabRunRequest> = {}): GabRunRequest {
  return {
    type: 'gab_run', protocolVersion: V, requestId: 'gab.run-1.first', role: 'first', exportPayload: { kind: 'array_buffer', bytes: source.bytes.slice(0) },
    exportIdentity: { ...source.identity }, entrySet: null, execution: { ...SYNTHETIC_EXECUTION }, ...overrides,
  }
}

const terminalOf = (messages: readonly GabResponse[], requestId?: string) => messages.filter(message => TERMINAL.has(message.type) && (requestId === undefined || ('requestId' in message && message.requestId === requestId)))
const resultOf = (messages: readonly GabResponse[]): GabWorkerResult => {
  const found = messages.find(message => message.type === 'gab_result')
  if (found?.type !== 'gab_result') throw new Error(JSON.stringify(messages.filter(message => message.type === 'gab_error')))
  return found.result
}

describe('P-1 Worker controller: one run per Worker', () => {
  it('sends accepted, progress, heartbeats and one result, with the Worker\'s own observations and the stage\'s semantic records', async () => {
    const source = await syntheticExport()
    let tick = 0
    const { controller, messages } = controllerOf(syntheticControllerOptions(source, { now: () => (tick += 100) }))
    await controller.handleMessage(runRequest(source))
    expect(messages[0]).toMatchObject({ type: 'gab_accepted', protocolVersion: V, requestId: 'gab.run-1.first', role: 'first' })
    expect(terminalOf(messages)).toHaveLength(1)
    expect(messages.at(-1)!.type).toBe('gab_result')
    const result = resultOf(messages)
    const progress = messages.filter(message => message.type === 'gab_progress')
    const heartbeats = messages.filter(message => message.type === 'gab_heartbeat')
    expect(heartbeats.length).toBeGreaterThan(0)
    expect(result.observed.heartbeats).toBe(heartbeats.length)
    expect(result.observed.progressEvents).toBe(progress.length)
    expect(result.observed.yields).toBeGreaterThan(0)
    expect(result.observed.longestYieldGap).not.toBeNull()
    expect(Object.keys(result.observed.slices)).toEqual(expect.arrayContaining(['accepted', 'input', 'phase0', 'phase_a', 'phase_bc', 'phase_d', 'phase_d_prime:planner']))
    expect(result).toMatchObject({ protocolVersion: V, requestId: 'gab.run-1.first', role: 'first', formal: false, oracleFreeExecution: true, integrityIssues: [],
      conditions: { source: 'test_injected', researchMaxPlanSteps: 20_000, verificationBudget: 1 }, exportObservation: { ...source.identity, matchesRequest: true } })
    expect(result.environment.protocolVersion).toBe(V)
    // The progress relays the stage's own events, in order: the input stages first, the evidence last.
    expect(progress.slice(0, 2).map(message => message.type === 'gab_progress' ? message.event : null)).toEqual([
      { kind: 'input', stage: 'export_read', status: 'started' }, { kind: 'input', stage: 'export_read', status: 'finished' },
    ])
    // The semantic records are the stage module's, whatever the Worker's clock and heartbeat did.
    const stage = await runFirstStage(SYNTHETIC_CONDITIONS, syntheticProvenance(source, 'no-benchmark-build-commit'), syntheticPorts(source))
    expect(result.materialization!.semanticSha256).toBe(stage.materialization!.semanticSha256)
    expect(result.verification!.semanticSha256).toBe(stage.verification!.semanticSha256)
    expect(result.verification!.semanticSha256).toBe(await webCryptoSha256(JSON.stringify(result.verification!.semantic)))
  }, 120_000)

  it('reads a Blob payload (with the File name) and an ArrayBuffer payload alike', async () => {
    const source = await syntheticExport()
    const viaBytes = controllerOf(syntheticControllerOptions(source))
    await viaBytes.controller.handleMessage(runRequest(source))
    const viaBlob = controllerOf(syntheticControllerOptions(source))
    const file = new File([source.bytes.slice(0)], source.identity.fileName, { type: 'application/json' })
    await viaBlob.controller.handleMessage(runRequest(source, { exportPayload: { kind: 'blob', blob: file } }))
    expect(resultOf(viaBlob.messages).materialization!.semanticSha256).toBe(resultOf(viaBytes.messages).materialization!.semanticSha256)
    expect(resultOf(viaBlob.messages).exportObservation).toEqual({ ...source.identity, matchesRequest: true })
  }, 120_000)

  it('refuses a repeated request and a second request on the same Worker, before any calculation', async () => {
    const source = await syntheticExport()
    const { controller, messages } = controllerOf(syntheticControllerOptions(source))
    const running = controller.handleMessage(runRequest(source))
    await controller.handleMessage(runRequest(source))
    await controller.handleMessage(runRequest(source, { requestId: 'gab.run-2.first' }))
    await running
    expect(messages.filter(message => message.type === 'gab_error').map(message => message.type === 'gab_error' ? [message.requestId, message.error.code] : null))
      .toEqual([['gab.run-1.first', 'duplicate_request'], ['gab.run-2.first', 'worker_already_used']])
    expect(messages.filter(message => message.type === 'gab_accepted')).toHaveLength(1)
    expect(messages.filter(message => message.type === 'gab_result')).toHaveLength(1)
  }, 120_000)

  it('refuses malformed, foreign-version and condition-carrying requests without consuming the Worker', async () => {
    const source = await syntheticExport()
    const { controller, messages } = controllerOf(syntheticControllerOptions(source))
    const valid = runRequest(source)
    const bad: unknown[] = [
      { ...valid, conditions: { window: { skill: 1, gogma: 1, normal: 1 } } },
      { ...valid, expectedSemanticSha256: 'a'.repeat(64) },
      { ...valid, protocolVersion: 'global-assignment-browser:0' },
      { ...valid, role: 'second' },
      { ...valid, role: 'fresh', entrySet: null },
      { ...valid, entrySet: { kind: 'global-assignment-d1a-entry-set' } },
      { ...valid, execution: { ...valid.execution, heartbeatIntervalMs: 0 } },
      { ...valid, execution: { ...valid.execution, extra: true } },
      { ...valid, exportIdentity: { ...valid.exportIdentity, sha256: 'XYZ' } },
      { ...valid, exportPayload: { kind: 'url', url: 'x' } },
      { ...valid, requestId: 'has space' },
      { type: 'gab_cancel', protocolVersion: V },
      { type: 'gab_ping', protocolVersion: 'other', pingId: 1 },
    ]
    for (const message of bad) await controller.handleMessage(message)
    const errors = messages.filter(message => message.type === 'gab_error')
    expect(errors).toHaveLength(bad.length)
    expect(errors.every(message => message.type === 'gab_error' && message.error.code === 'invalid_request')).toBe(true)
    expect(messages.filter(message => message.type === 'gab_accepted')).toHaveLength(0)
    // Messages of other protocols are ignored outright.
    await controller.handleMessage({ type: 'pg2a_benchmark_run' })
    await controller.handleMessage('not a message')
    expect(messages).toHaveLength(bad.length)
    // The Worker was never consumed: a valid request still runs.
    await controller.handleMessage(valid)
    expect(resultOf(messages).requestId).toBe('gab.run-1.first')
    await controller.handleMessage({ type: 'gab_ping', protocolVersion: V, pingId: 7 })
    expect(messages.at(-1)).toEqual({ type: 'gab_pong', protocolVersion: V, pingId: 7 })
  }, 120_000)

  it('refuses an Export whose bytes are not the observed identity before decoding it (export_changed)', async () => {
    const source = await syntheticExport()
    const { controller, messages } = controllerOf(syntheticControllerOptions(source))
    await controller.handleMessage(runRequest(source, { exportIdentity: { ...source.identity, sha256: 'f'.repeat(64) } }))
    expect(terminalOf(messages)).toEqual([expect.objectContaining({ type: 'gab_error', error: expect.objectContaining({ code: 'export_changed', stage: 'export_hash' }) })])
    const stages = messages.flatMap(message => message.type === 'gab_progress' ? [message.event.kind === 'input' ? `${message.event.stage}:${message.event.status}` : message.event.kind] : [])
    expect(stages).toEqual(['export_read:started', 'export_read:finished', 'export_hash:started', 'export_hash:finished'])
  }, 60_000)

  it('reports a calculation failure as one gab_error (never a result or a no-match)', async () => {
    const source = await syntheticExport()
    let engines = 0
    const { controller, messages } = controllerOf(syntheticControllerOptions(source, {
      createEngine: () => { engines += 1; if (engines === 3) throw new Error('engine construction failed'); return source.createEngine() },
    }))
    await controller.handleMessage(runRequest(source))
    expect(terminalOf(messages)).toEqual([expect.objectContaining({ type: 'gab_error', error: expect.objectContaining({ code: 'calculation_failed', errorName: 'Error', message: 'engine construction failed' }) })])
  }, 120_000)
})

describe('P-1 Worker controller: cooperative cancel (best effort only)', () => {
  it('acknowledges a cancel at once, for a running, finished or unknown request alike', async () => {
    const source = await syntheticExport()
    const { controller, messages } = controllerOf(syntheticControllerOptions(source))
    await controller.handleMessage({ type: 'gab_cancel', protocolVersion: V, requestId: 'gab.unknown.first' })
    expect(messages).toEqual([{ type: 'gab_cancel_ack', protocolVersion: V, requestId: 'gab.unknown.first' }])
  })

  it('stops at an existing cancel point once a cancel was dispatched at a yield, and sends gab_cancelled instead of a result', async () => {
    const source = await syntheticExport()
    let controller: ReturnType<typeof createGlobalAssignmentBrowserController> | null = null
    let yields = 0
    const built = controllerOf(syntheticControllerOptions(source, {
      // The cancel message is dispatched at the first yield (a macrotask boundary of the real Worker).
      yieldFor: () => async () => { yields += 1; if (yields === 1) void controller!.handleMessage({ type: 'gab_cancel', protocolVersion: V, requestId: 'gab.run-1.first' }) },
    }))
    controller = built.controller
    await controller.handleMessage(runRequest(source))
    expect(built.messages.filter(message => message.type === 'gab_cancel_ack')).toHaveLength(1)
    expect(terminalOf(built.messages)).toEqual([expect.objectContaining({ type: 'gab_cancelled', observed: expect.objectContaining({ via: expect.stringMatching(/cancel_point|before_result/) }) })])
    expect(built.messages.some(message => message.type === 'gab_result')).toBe(false)
  }, 120_000)

  it('checks the flag once more just before posting the result', async () => {
    const source = await syntheticExport()
    let controller: ReturnType<typeof createGlobalAssignmentBrowserController> | null = null
    const built = controllerOf(syntheticControllerOptions(source, {
      // The cancel arrives while the verification record is hashed: the calculation is complete, but no result is posted.
      sha256Text: async text => {
        if (text.includes('"traceReplay"')) void controller!.handleMessage({ type: 'gab_cancel', protocolVersion: V, requestId: 'gab.run-1.first' })
        return webCryptoSha256(text)
      },
    }))
    controller = built.controller
    await controller.handleMessage(runRequest(source))
    expect(terminalOf(built.messages)).toEqual([expect.objectContaining({ type: 'gab_cancelled', observed: expect.objectContaining({ via: 'before_result' }) })])
  }, 120_000)
})

describe('P-1 Worker controller: the Worker entry\'s own dependencies', () => {
  it('runs the Production Engine, the pure Export path with maxPlanSteps 1,000 and the registered D-1C conditions (minimal synthetic Export)', async () => {
    const minimal = await bytesOf(JSON.stringify(minimalSyntheticExportRoot()))
    const { controller, messages } = controllerOf({ ...globalAssignmentBrowserWorkerOptions(), yieldFor: () => async () => undefined, build: () => null })
    await controller.handleMessage(runRequest(minimal))
    const result = resultOf(messages)
    const registered = registeredD1cConditions()
    expect(result.conditions).toEqual({ materialization: registered.materialization, researchMaxPlanSteps: registered.verification.researchMaxPlanSteps, verificationBudget: registered.verification.verificationBudget, source: 'registeredD1cConditions' })
    expect(result.plannerInputMaxPlanStepsForValidationOnly).toBe(1_000)
    expect(result.rngEngineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(result.environment.rngEngineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(result.materialization!.semantic.outcome).toEqual({ kind: 'unsupported_input', stage: 'context', reason: 'no_planning_target' })
    expect(result).toMatchObject({ entrySet: null, verification: null, phase0: { planningTargetCount: 0, planningTargetIdsSorted: null } })
  }, 60_000)

  it('reports unparsable JSON and an Export that fails validation as input_build_failed (gab_error), never as a calculation outcome', async () => {
    for (const [text, stage] of [['{"broken":', 'json_parse'], ['{}', 'input_build']] as const) {
      const input = await bytesOf(text)
      const { controller, messages } = controllerOf({ ...globalAssignmentBrowserWorkerOptions(), yieldFor: () => async () => undefined, build: () => null })
      await controller.handleMessage(runRequest(input))
      expect(terminalOf(messages)).toEqual([expect.objectContaining({ type: 'gab_error', error: expect.objectContaining({ code: 'input_build_failed', stage }) })])
    }
  }, 60_000)

  it('announces readiness with its environment probe, and reports an undeserializable message without guessing its request', () => {
    const posted: GabResponse[] = []
    const listeners = new Map<string, (event: { data: unknown }) => void>()
    attachGlobalAssignmentBrowserWorker({ postMessage: message => posted.push(message), addEventListener: (type, listener) => { listeners.set(type, listener) } }, { ...globalAssignmentBrowserWorkerOptions(), build: () => ({ commit: 'a'.repeat(40) }) })
    expect(posted[0]).toMatchObject({ type: 'gab_ready', protocolVersion: V, environment: { protocolVersion: V, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, buildCommit: 'a'.repeat(40), build: { commit: 'a'.repeat(40) } } })
    expect(Object.keys(posted[0]!.type === 'gab_ready' ? posted[0].environment.capabilities : {})).toEqual(['cryptoSubtle', 'messageChannel', 'structuredClone', 'textDecoder', 'workerPerformanceMemory'])
    listeners.get('messageerror')!({ data: null })
    expect(posted[1]).toMatchObject({ type: 'gab_error', requestId: null, error: { code: 'invalid_request', stage: 'message' } })
  })

  it('attributes slices to the calculation stage each progress event leaves the Worker in', () => {
    expect(gabSliceStageAfter({ kind: 'input', stage: 'input_build', status: 'finished' }, 'first')).toBe('phase0')
    expect(gabSliceStageAfter({ kind: 'input', stage: 'input_build', status: 'finished' }, 'fresh')).toBe('input')
    expect(gabSliceStageAfter({ kind: 'input', stage: 'phase0', status: 'finished' }, 'fresh')).toBe('entry_set_check')
    expect(gabSliceStageAfter({ kind: 'materialization', event: { kind: 'context', status: 'context', planningTargetCount: 1, reason: null } }, 'first')).toBe('phase_a')
    expect(gabSliceStageAfter({ kind: 'materialization', event: { kind: 'reach_table', status: 'reach_table', predictions: null } }, 'first')).toBe('phase_bc')
    expect(gabSliceStageAfter({ kind: 'verification', event: { stage: 'trace_replay', status: 'started' } }, 'fresh')).toBe('phase_d_prime:trace_replay')
  })
})
