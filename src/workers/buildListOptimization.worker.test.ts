import { describe, expect, it, vi } from 'vitest'
import type { PlannerDependencies, PlannerInput } from '../domain/planner'
import {
  BuildListOptimizationInvariantError,
  BuildListOptimizationMaterializationError,
  runBuildListOptimization,
  type BuildListOptimizationExecution,
  type BuildListOptimizationResult,
  type BuildListOptimizationRun,
  type BuildListOptimizationStage,
} from '../domain/planner/buildListOptimization'
import { stableStringify } from '../domain/models/publicTypes'
import { buildListOptimizationResultIssues } from '../services/planner/buildListOptimizationResultCheck'
import {
  BUILD_LIST_OPTIMIZATION_TEST_BOUNDS,
  createBuildListOptimizationTestInput,
} from '../test/fixtures/buildListOptimizationWorkerFixtures'
import { createDeterministicPlannerDependencies, createPlannerSchedulerWorkloadInput } from '../test/fixtures/plannerSchedulerWorkloads'
import {
  attachBuildListOptimizationWorker,
  BuildListOptimizationSearchBoundsUnavailableError,
  BuildListOptimizationWorkerProtocolError,
  createBuildListOptimizationWorkerController,
  type BuildListOptimizationWorkerCalculation,
  type BuildListOptimizationWorkerRuntime,
} from './buildListOptimization.worker'
import {
  attachBuildListOptimizationBenchmarkWorker,
  createBuildListOptimizationBenchmarkBoundsMessage,
} from './buildListOptimization.worker.benchmark'
import {
  createBuildListOptimizationCalculation,
  createBuildListOptimizationWorkerRuntime,
  createProductionBuildListOptimizationWorkerRuntime,
  PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS,
} from './buildListOptimization.worker.production'
import {
  BUILD_LIST_OPTIMIZATION_RUN_REQUEST_KEYS,
  BUILD_LIST_OPTIMIZATION_STAGES,
  BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION,
  buildListOptimizationRunRequestIssues,
  buildListOptimizationWorkerResponseIssues,
  type BuildListOptimizationWorkerResponse,
  type BuildListOptimizationWorkerRunRequest,
} from './buildListOptimizationWorkerContracts'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const runRequestKeysAreTheProtocolKeys: Equal<keyof BuildListOptimizationWorkerRunRequest, (typeof BUILD_LIST_OPTIMIZATION_RUN_REQUEST_KEYS)[number]> = true
const stagesAreTheDomainStages: Equal<(typeof BUILD_LIST_OPTIMIZATION_STAGES)[number], BuildListOptimizationStage> = true

const NOT_FOUND: BuildListOptimizationResult = {
  status: 'not_found',
  reason: 'no_structural_candidate',
  diagnostics: { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 0, elapsedMs: null },
}

function request(overrides: Partial<Record<keyof BuildListOptimizationWorkerRunRequest, unknown>> = {}): BuildListOptimizationWorkerRunRequest {
  return {
    type: 'blo_run',
    protocolVersion: BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION,
    requestId: 'request-1',
    input: createBuildListOptimizationTestInput(),
    ...overrides,
  } as BuildListOptimizationWorkerRunRequest
}

const fakeDependencies = { rngEngine: {}, idFactory: {}, clock: {} } as unknown as PlannerDependencies

function runtimeOf(calculation: BuildListOptimizationWorkerCalculation, extra: Partial<BuildListOptimizationWorkerRuntime> = {}): BuildListOptimizationWorkerRuntime {
  return { createDependencies: () => fakeDependencies, calculation, ...extra }
}

function controllerWith(calculation: BuildListOptimizationWorkerCalculation, extra: Partial<BuildListOptimizationWorkerRuntime> = {}) {
  const posted: BuildListOptimizationWorkerResponse[] = []
  const controller = createBuildListOptimizationWorkerController(runtimeOf(calculation, extra), (response) => {
    posted.push(structuredClone(response))
  })
  return { controller, posted }
}

/** A calculation that enters the given stages, then returns the run. */
function stagedCalculation(stages: readonly BuildListOptimizationStage[], run: BuildListOptimizationRun = { kind: 'result', result: NOT_FOUND }) {
  return vi.fn<BuildListOptimizationWorkerCalculation>(async (_input, _dependencies, execution) => {
    for (const stage of stages) execution.onStage?.(stage)
    return run
  })
}

describe('Build List optimization Worker protocol', () => {
  it('ties the run request to exactly its protocol keys and the stage list to the Domain stages', () => {
    expect(runRequestKeysAreTheProtocolKeys).toBe(true)
    expect(stagesAreTheDomainStages).toBe(true)
    expect([...BUILD_LIST_OPTIMIZATION_RUN_REQUEST_KEYS].sort()).toEqual(['input', 'protocolVersion', 'requestId', 'type'])
    expect(BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION).toBe('build-list-optimization:1')
  })

  it('accepts a well-formed run request and names every broken field of a malformed one', () => {
    expect(buildListOptimizationRunRequestIssues(request())).toEqual([])
    expect(buildListOptimizationRunRequestIssues(null)).toEqual(['request must be an object.'])
    expect(buildListOptimizationRunRequestIssues(request({ protocolVersion: 'build-list-optimization:0' })).join(' ')).toMatch(/protocolVersion/)
    expect(buildListOptimizationRunRequestIssues(request({ type: 'create_plan' })).join(' ')).toMatch(/type must be blo_run/)
    expect(buildListOptimizationRunRequestIssues(request({ requestId: '' })).join(' ')).toMatch(/requestId must be a non-empty string/)
    expect(buildListOptimizationRunRequestIssues(request({ requestId: 7 })).join(' ')).toMatch(/requestId/)
    expect(buildListOptimizationRunRequestIssues(request({ input: [] })).join(' ')).toMatch(/input must be a PlannerInput object/)
    const input = createBuildListOptimizationTestInput() as unknown as Record<string, unknown>
    delete input.buildListEntries
    expect(buildListOptimizationRunRequestIssues(request({ input })).join(' ')).toMatch(/input\.buildListEntries must be an array/)
    // No bound, window, step bound, expected hash or token travels in a request.
    for (const field of ['bounds', 'window', 'maxPlanSteps', 'expectedHash', 'inputToken', 'observedDraftPlanId']) {
      expect(buildListOptimizationRunRequestIssues({ ...request(), [field]: 1 }), field).toEqual([`request.${field} is not a protocol field.`])
    }
  })

  it('checks a response envelope: progress carries the stage name only, an error a protocol code', () => {
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_progress', requestId: 'r', stage: 'reach_table' })).toEqual([])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_progress', requestId: 'r', stage: 'reach_table', percent: 40 })).toEqual(['progress.percent is not a protocol field.'])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_progress', requestId: 'r', stage: 'stage_9' })).toEqual(['progress.stage must be a stage name.'])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_result', requestId: 'r', result: NOT_FOUND })).toEqual([])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_result', requestId: 'r', result: null })).toEqual(['result.result must be an object.'])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_error', requestId: 'r', stage: null, code: 'calculation_failed', domainCode: null, message: 'x' })).toEqual([])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_error', requestId: 'r', stage: null, code: 'out_of_memory', domainCode: null, message: 'x' })).toEqual(['error.code must be a protocol error code.'])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_cancelled', requestId: 'r' })).toEqual(['response.type must be blo_progress, blo_result or blo_error.'])
    expect(buildListOptimizationWorkerResponseIssues({ type: 'blo_result', requestId: '', result: NOT_FOUND })).toEqual(['response.requestId must be a non-empty string.'])
  })
})

describe('Build List optimization Worker controller', () => {
  it('posts each stage name, then exactly one result, and hands the calculation no cancel or yield hook', async () => {
    const calculation = stagedCalculation(BUILD_LIST_OPTIMIZATION_STAGES)
    const { controller, posted } = controllerWith(calculation)
    await controller.handleMessage(request())
    expect(posted).toEqual([
      ...BUILD_LIST_OPTIMIZATION_STAGES.map(stage => ({ type: 'blo_progress', requestId: 'request-1', stage })),
      { type: 'blo_result', requestId: 'request-1', result: NOT_FOUND },
    ])
    expect(calculation).toHaveBeenCalledTimes(1)
    const execution = calculation.mock.calls[0]![2]
    expect(Object.keys(execution)).toEqual(['onStage'])
    // The Worker cancels only by being terminated: no shouldCancel, no yieldControl.
    expect(execution.shouldCancel).toBeUndefined()
    expect(execution.yieldControl).toBeUndefined()
    // The input reaches the calculation as received.
    expect(stableStringify(calculation.mock.calls[0]![0])).toBe(stableStringify(createBuildListOptimizationTestInput()))
  })

  it('passes the Worker clock for the diagnostics timings only when the runtime has one', async () => {
    const calculation = stagedCalculation([])
    const now = () => 1
    await controllerWith(calculation, { now }).controller.handleMessage(request())
    expect(calculation.mock.calls[0]![2]).toEqual({ onStage: expect.any(Function), now })
  })

  it('answers a malformed request with invalid_request and never calculates', async () => {
    for (const malformed of [request({ protocolVersion: 'build-list-optimization:2' }), request({ input: null }), { ...request(), bounds: BUILD_LIST_OPTIMIZATION_TEST_BOUNDS }]) {
      const calculation = stagedCalculation([])
      const { controller, posted } = controllerWith(calculation)
      await controller.handleMessage(malformed)
      expect(calculation).not.toHaveBeenCalled()
      expect(posted).toHaveLength(1)
      expect(posted[0]).toMatchObject({ type: 'blo_error', requestId: 'request-1', stage: null, code: 'invalid_request', domainCode: null })
    }
  })

  it('throws for a message that names no requestId: nothing can be posted for it', () => {
    for (const unaddressable of [null, 'blo_run', request({ requestId: '' }), request({ requestId: 3 }), { type: 'blo_benchmark_bounds' }]) {
      const calculation = stagedCalculation([])
      const { controller, posted } = controllerWith(calculation)
      expect(() => controller.handleMessage(unaddressable)).toThrow(BuildListOptimizationWorkerProtocolError)
      expect(posted).toEqual([])
      expect(calculation).not.toHaveBeenCalled()
    }
  })

  it('serves one run: a repeat of the running requestId is dropped and another requestId is refused', async () => {
    let finish!: (run: BuildListOptimizationRun) => void
    const calculation = vi.fn<BuildListOptimizationWorkerCalculation>(() => new Promise((resolve) => {
      finish = resolve
    }))
    const { controller, posted } = controllerWith(calculation)
    const running = controller.handleMessage(request())
    await controller.handleMessage(request())
    await controller.handleMessage(request({ requestId: 'request-2' }))
    expect(calculation).toHaveBeenCalledTimes(1)
    expect(posted).toEqual([{ type: 'blo_error', requestId: 'request-2', stage: null, code: 'worker_already_used', domainCode: null, message: 'This Worker serves one run only.' }])
    finish({ kind: 'result', result: NOT_FOUND })
    await running
    await controller.handleMessage(request())
    expect(posted.filter(response => response.requestId === 'request-1')).toEqual([{ type: 'blo_result', requestId: 'request-1', result: NOT_FOUND }])
  })

  it('posts no progress after the terminal response', async () => {
    let onStage: BuildListOptimizationExecution['onStage']
    const { controller, posted } = controllerWith(async (_input, _dependencies, execution) => {
      onStage = execution.onStage
      execution.onStage?.('input_check')
      return { kind: 'result', result: NOT_FOUND }
    })
    await controller.handleMessage(request())
    onStage?.('reach_table')
    expect(posted.map(response => response.type)).toEqual(['blo_progress', 'blo_result'])
  })

  it('keeps a Domain error as an error with its own code and stage, never a result', async () => {
    const cases: [unknown, string, string | null][] = [
      [new BuildListOptimizationInvariantError('objective_mismatch', 'identity broken'), 'invariant_violation', 'objective_mismatch'],
      [new BuildListOptimizationMaterializationError('route_verification_failed', null, 'route checks failed'), 'materialization_failed', 'route_verification_failed'],
      [new RangeError('nodeBudget must be a positive safe integer (got 0).'), 'calculation_failed', null],
      ['not an Error', 'calculation_failed', null],
    ]
    for (const [error, code, domainCode] of cases) {
      const { controller, posted } = controllerWith(async (_input, _dependencies, execution) => {
        execution.onStage?.('input_check')
        execution.onStage?.('plan_verification')
        throw error
      })
      await controller.handleMessage(request())
      expect(posted.at(-1)).toMatchObject({ type: 'blo_error', requestId: 'request-1', stage: 'plan_verification', code, domainCode })
      expect(posted.filter(response => response.type === 'blo_result')).toEqual([])
    }
  })

  it('reports a cancellation no one requested as a failure, never as a result', async () => {
    const { controller, posted } = controllerWith(stagedCalculation(['input_check'], { kind: 'cancelled' }))
    await controller.handleMessage(request())
    expect(posted.at(-1)).toMatchObject({ type: 'blo_error', code: 'calculation_failed', stage: 'input_check' })
  })

  it('answers a result that cannot be sent with an error instead of nothing', async () => {
    const posted: BuildListOptimizationWorkerResponse[] = []
    const controller = createBuildListOptimizationWorkerController(runtimeOf(stagedCalculation([])), (response) => {
      if (response.type === 'blo_result') throw new DOMException('could not be cloned', 'DataCloneError')
      posted.push(response)
    })
    await controller.handleMessage(request())
    expect(posted).toEqual([{ type: 'blo_error', requestId: 'request-1', stage: null, code: 'calculation_failed', domainCode: null, message: 'could not be cloned' }])
  })

  it('creates the dependencies inside the Worker, per run, and reports their failure as an error', async () => {
    const createDependencies = vi.fn(() => {
      throw new Error('engine unavailable')
    })
    const calculation = stagedCalculation([])
    const posted: BuildListOptimizationWorkerResponse[] = []
    await createBuildListOptimizationWorkerController({ createDependencies, calculation }, response => posted.push(response)).handleMessage(request())
    expect(createDependencies).toHaveBeenCalledTimes(1)
    expect(calculation).not.toHaveBeenCalled()
    expect(posted).toEqual([{ type: 'blo_error', requestId: 'request-1', stage: null, code: 'calculation_failed', domainCode: null, message: 'engine unavailable' }])
  })

  it('attaches to the Worker scope and lets an unaddressable message escape as an uncaught Worker error', () => {
    let listener: ((event: { data: unknown }) => void) | null = null
    const posted: unknown[] = []
    attachBuildListOptimizationWorker({ postMessage: response => posted.push(response), addEventListener: (_type, value) => { listener = value } }, runtimeOf(stagedCalculation([])))
    expect(listener).not.toBeNull()
    expect(() => listener!({ data: { type: 'blo_run' } })).toThrow(BuildListOptimizationWorkerProtocolError)
  })
})

describe('Build List optimization Production Worker adapter', () => {
  it('has no Production search bounds yet, and refuses to run instead of guessing them', async () => {
    expect(PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS).toBeNull()
    await expect(createBuildListOptimizationCalculation(null)(createBuildListOptimizationTestInput(), fakeDependencies, {}))
      .rejects.toBeInstanceOf(BuildListOptimizationSearchBoundsUnavailableError)
    const posted: BuildListOptimizationWorkerResponse[] = []
    await createBuildListOptimizationWorkerController(createProductionBuildListOptimizationWorkerRuntime(), response => posted.push(response)).handleMessage(request())
    expect(posted).toEqual([{
      type: 'blo_error', requestId: 'request-1', stage: null, code: 'search_bounds_unavailable', domainCode: null,
      message: new BuildListOptimizationSearchBoundsUnavailableError().message,
    }])
  })

  it('composes the Production Engine, ID factory and Clock inside the Worker and hands the Domain a copy of the bounds', () => {
    const runtime = createBuildListOptimizationWorkerRuntime(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS)
    const dependencies = runtime.createDependencies()
    expect(dependencies.rngEngine.constructor.name).toBe('ProductionRngEngine')
    expect(typeof dependencies.idFactory.productionPlanId).toBe('function')
    expect(typeof dependencies.clock.now).toBe('function')
    expect(typeof runtime.now).toBe('function')
  })

  it('runs the Production calculation through the Worker path with explicit bounds: stage names, then a result equal to the direct run', async () => {
    const posted: BuildListOptimizationWorkerResponse[] = []
    const bounds = structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS)
    const controller = createBuildListOptimizationWorkerController(createBuildListOptimizationWorkerRuntime(bounds), (response) => {
      // The wire: every message is structured-cloned.
      posted.push(structuredClone(response))
    })
    // Mutating the caller's bounds after the runtime was composed changes nothing.
    bounds.window.gogma = 1
    await controller.handleMessage(request())
    const progress = posted.filter(response => response.type === 'blo_progress').map(response => response.type === 'blo_progress' ? response.stage : null)
    expect(progress).toEqual([...BUILD_LIST_OPTIMIZATION_STAGES])
    const terminal = posted.at(-1)!
    expect(terminal.type).toBe('blo_result')
    if (terminal.type !== 'blo_result' || terminal.result.status !== 'optimized') throw new Error('expected an optimized result')
    expect(buildListOptimizationResultIssues(terminal.result)).toEqual([])
    expect(terminal.result.artifact.diagnostics.elapsedMs).not.toBeNull()

    // The same semantics as the direct Domain run (Plan / Step IDs and times are the Production factory's and Clock's).
    const fixture = createPlannerSchedulerWorkloadInput('sanity-3')
    const direct = await runBuildListOptimization(fixture.input, createDeterministicPlannerDependencies(fixture.engine), structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS))
    if (direct.kind !== 'result' || direct.result.status !== 'optimized') throw new Error('expected a direct optimized result')
    const semantic = (artifact: typeof direct.result.artifact) => ({
      summary: artifact.summary,
      replacements: artifact.replacements,
      generatedEntryIds: artifact.generatedBuildListEntries.map(entry => entry.id),
      unchanged: artifact.unchangedTargetWeaponIds,
      planning: artifact.planningTargetWeaponIds,
      inputExclusions: artifact.inputExclusions,
      inputToken: artifact.inputToken,
      steps: artifact.plannerResult.plan!.steps.map(step => [step.operationType, step.buildListEntryId, stableStringify(step.rngAdvance)]),
    })
    expect(semantic(terminal.result.artifact)).toEqual(semantic(direct.result.artifact))
    expect(terminal.result.artifact.summary.completedTargetCount).toBe(3)
  })
})

describe('Build List optimization benchmark-only measurement Worker', () => {
  function attach(createRuntime = vi.fn((bounds: Parameters<typeof createBuildListOptimizationWorkerRuntime>[0]) => runtimeOf(stagedCalculation([]), { calculation: createBuildListOptimizationCalculation(bounds) }))) {
    let listener: ((event: { data: unknown }) => void) | null = null
    const posted: BuildListOptimizationWorkerResponse[] = []
    attachBuildListOptimizationBenchmarkWorker({ postMessage: response => posted.push(response), addEventListener: (_type, value) => { listener = value } }, createRuntime)
    return { send: (data: unknown) => listener!({ data }), posted, createRuntime }
  }

  it('takes the bounds from its configuration message, then runs the ordinary controller over the Production adapter', async () => {
    const calculation = stagedCalculation(['input_check'])
    const createRuntime = vi.fn(() => runtimeOf(calculation))
    const worker = attach(createRuntime)
    worker.send(createBuildListOptimizationBenchmarkBoundsMessage(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS))
    expect(createRuntime).toHaveBeenCalledWith(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS)
    worker.send(request())
    await vi.waitFor(() => expect(worker.posted.at(-1)?.type).toBe('blo_result'))
    expect(calculation).toHaveBeenCalledTimes(1)
  })

  it('refuses a run that came before any bounds, and a configuration after the run', async () => {
    const worker = attach()
    worker.send(request())
    await vi.waitFor(() => expect(worker.posted.at(-1)).toMatchObject({ type: 'blo_error', code: 'search_bounds_unavailable' }))
    expect(() => worker.send(createBuildListOptimizationBenchmarkBoundsMessage(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS))).toThrow(BuildListOptimizationWorkerProtocolError)
  })

  it('keeps the bounds out of the run request: the configuration is its own benchmark message', () => {
    const message = createBuildListOptimizationBenchmarkBoundsMessage(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS)
    expect(Object.keys(message).sort()).toEqual(['bounds', 'protocolVersion', 'type'])
    expect(message.protocolVersion).not.toBe(BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION)
    expect(buildListOptimizationRunRequestIssues(message).length).toBeGreaterThan(0)
  })
})

describe('Build List optimization Worker inputs', () => {
  it('runs from the PlannerInput alone (the Domain Stage 0 validates its content)', async () => {
    const calculation = stagedCalculation([])
    const input: PlannerInput = { ...createBuildListOptimizationTestInput(), buildListEntries: [] }
    await controllerWith(calculation).controller.handleMessage(request({ input }))
    expect(calculation.mock.calls[0]![0].buildListEntries).toEqual([])
  })
})
