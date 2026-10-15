import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { ProductionPlan, ProductionPlanId } from '../../domain/models/publicTypes'
import { createProductionPlannerDependencies, defaultPlannerOptions, type PlannerDependencies, type PlannerInput, type PlannerResult } from '../../domain/planner'
import type { BuildListOptimizationResult, BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { createValidProductionPlan } from '../../test/fixtures/domainData'
import { bonusPart, checkpointPart, legacyDuplicateScenario, planCreationScenario } from '../../test/fixtures/planCreationMethod'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'
import { createBuildListCalculationContext } from '../buildList/createBuildListCalculationContext'
import {
  buildListOptimizationAdoptionSourceOf,
  createBuildListOptimizationSession,
  createBuildListOptimizationStartReader,
  type BuildListOptimizationStartPreparation,
  type BuildListOptimizationStartReader,
} from './buildListOptimizationService'
import type {
  BuildListOptimizationRunHandle,
  BuildListOptimizationRunObserver,
  BuildListOptimizationRunOutcome,
  BuildListOptimizationWorkerClient,
} from './buildListOptimizationWorkerClient'
import {
  createPlanCreationPreparer,
  createPlanCreationSession,
  isOrdinaryPlannerAuxiliaryOffered,
  type PlanCreationPreparation,
  type PlanCreationSession,
  type PlanCreationSessionState,
} from './planCreationService'
import { PlannerCancelledError, type PlannerWorkerClient } from './plannerWorkerClient'

/*
 * Issue #260 PR-6B1: the plan creation boundary of the Build List screen (`docs/PLANNER_SPEC.md` 17.2 U1 / 17.4 / 17.16). The start
 * reader and the judgement are real (a Dexie database and the Production Engine, or the in-memory orchestration fixture); both Worker
 * Clients are fakes that record what was started and settle when the test says so.
 */

const loaded = loadMasterData()
if (!loaded.ok) throw new Error('Master Data is invalid.')
const master = loaded.data

// ---------------------------------------------------------------------------------------------------------------------------------
// Fakes and helpers

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settleResolve, settleReject) => {
    resolve = settleResolve
    reject = settleReject
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** The Build List optimization Worker Client: every run is recorded and settles when the test says so. */
function fakeOptimizationClient() {
  const runs: { input: PlannerInput; observer?: BuildListOptimizationRunObserver; settle: (outcome: BuildListOptimizationRunOutcome) => void; cancel: ReturnType<typeof vi.fn>; requestId: string }[] = []
  const client: BuildListOptimizationWorkerClient = {
    run: vi.fn((input: PlannerInput, observer?: BuildListOptimizationRunObserver): BuildListOptimizationRunHandle => {
      const requestId = `optimization-run-${runs.length + 1}`
      let settle!: (outcome: BuildListOptimizationRunOutcome) => void
      const outcome = new Promise<BuildListOptimizationRunOutcome>((resolve) => {
        settle = resolve
      })
      const cancel = vi.fn(() => settle({ status: 'cancelled', requestId, reason: 'cancelled' }))
      runs.push({ input, observer, settle, cancel, requestId })
      return { requestId, outcome, cancel }
    }),
    cancel: vi.fn(),
    dispose: vi.fn(),
    getState: vi.fn(() => 'idle' as const),
  }
  return { client, runs }
}

/** The Production Planner Worker Client: `createPlan()` is recorded and settles when the test says so; `cancelPlan()` rejects it. */
function fakePlannerClient() {
  const calls: { requestId: string; input: PlannerInput; resolve: (result: PlannerResult) => void; reject: (error: unknown) => void }[] = []
  const unused = () => Promise.reject(new Error('Not a plan creation request.'))
  const client: PlannerWorkerClient = {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn((requestId: string, input: PlannerInput) => {
      const pending = deferred<PlannerResult>()
      calls.push({ requestId, input, resolve: pending.resolve, reject: pending.reject })
      return pending.promise
    }),
    createPlannerAlternativeComparison: vi.fn(unused),
    createPlannerAlternativeRepair: vi.fn(unused),
    prepareInteraction: vi.fn(unused),
    cancelPlan: vi.fn((requestId: string) => {
      calls.find(call => call.requestId === requestId)?.reject(new PlannerCancelledError())
    }),
    dispose: vi.fn(),
  }
  return { client, calls }
}

/** A Planner result stand-in: the session hands the ordinary Planner's result over as it is and never reads it. */
const PLANNER_RESULT = { marker: 'ordinary-planner-result' } as unknown as PlannerResult

const DIAGNOSTICS = { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 1, elapsedMs: null }
const NOT_FOUND: BuildListOptimizationResult = { status: 'not_found', reason: 'candidates_rejected', diagnostics: DIAGNOSTICS }
const SEARCH_BOUND: BuildListOptimizationResult = { status: 'search_bound_reached', bounds: [{ kind: 'planner_verification_budget', maxPlannerVerifications: 3 }], diagnostics: DIAGNOSTICS }

interface Harness {
  session: PlanCreationSession
  states: PlanCreationSessionState[]
  optimization: ReturnType<typeof fakeOptimizationClient>
  planner: ReturnType<typeof fakePlannerClient>
  createPlannerClient: ReturnType<typeof vi.fn>
  createOptimizationClient: ReturnType<typeof vi.fn>
  /** Every preparation the session's preparer returned, in order. */
  preparations: PlanCreationPreparation[]
  /** The session's preparer, called once per fresh read (before the read settles). */
  prepare: ReturnType<typeof vi.fn>
  /** The ordinary Planner auxiliary operation with a valid setting. */
  pressAuxiliary(): Promise<PlanCreationSessionState>
  /** The optimization session's own start reader: never called (the session hands it the start it judged). */
  optimizationOwnReader: ReturnType<typeof vi.fn>
}

function harness(startReader: BuildListOptimizationStartReader, plannerDependencies: PlannerDependencies): Harness {
  const optimization = fakeOptimizationClient()
  const planner = fakePlannerClient()
  const createOptimizationClient = vi.fn(() => optimization.client)
  const optimizationOwnReader = vi.fn(() => Promise.reject(new Error('The optimization session never reads the state itself here.')))
  const preparer = createPlanCreationPreparer({ startReader, plannerDependencies })
  const preparations: PlanCreationPreparation[] = []
  const prepare = vi.fn(async () => {
    const preparation = await preparer.prepare()
    preparations.push(preparation)
    return preparation
  })
  const recordingPreparer = { prepare }
  let requestSequence = 0
  const createPlannerClient = vi.fn(() => planner.client)
  const session = createPlanCreationSession({
    preparer: recordingPreparer,
    optimization: createBuildListOptimizationSession({ startReader: { read: optimizationOwnReader }, createClient: createOptimizationClient }),
    createPlannerClient,
    createRequestId: () => `planner-request-${++requestSequence}`,
  })
  const states: PlanCreationSessionState[] = []
  session.subscribe(state => states.push(state))
  return {
    session, states, optimization, planner, createPlannerClient, createOptimizationClient, preparations, prepare, optimizationOwnReader,
    pressAuxiliary: () => session.startOrdinaryPlanner({ plannerOptions: { maxPlanSteps: 40 } }),
  }
}

/**
 * Presses the auxiliary operation where the session does not offer it (17.2) and checks that the press had no side effect at all: the
 * very same state object, nothing published, no fresh read, no Client created, no Worker run started or cancelled.
 */
async function expectAuxiliaryRefused(h: Harness, label: string): Promise<void> {
  const before = h.session.getState()
  expect(isOrdinaryPlannerAuxiliaryOffered(before), label).toBe(false)
  const published = h.states.length
  const prepareCalls = h.prepare.mock.calls.length
  const plannerClients = h.createPlannerClient.mock.calls.length
  const createPlans = vi.mocked(h.planner.client.createPlan).mock.calls.length
  const cancelPlans = vi.mocked(h.planner.client.cancelPlan).mock.calls.length
  const optimizationClients = h.createOptimizationClient.mock.calls.length
  const optimizationRuns = h.optimization.runs.length
  const runCancels = h.optimization.runs.map(({ cancel }) => cancel.mock.calls.length)
  const returned = await h.pressAuxiliary()
  expect(returned, label).toBe(before)
  expect(h.session.getState(), label).toBe(before)
  expect(h.states, label).toHaveLength(published)
  expect(h.prepare.mock.calls, label).toHaveLength(prepareCalls)
  expect(h.createPlannerClient.mock.calls, label).toHaveLength(plannerClients)
  expect(vi.mocked(h.planner.client.createPlan).mock.calls, label).toHaveLength(createPlans)
  expect(vi.mocked(h.planner.client.cancelPlan).mock.calls, label).toHaveLength(cancelPlans)
  expect(h.createOptimizationClient.mock.calls, label).toHaveLength(optimizationClients)
  expect(h.optimization.runs, label).toHaveLength(optimizationRuns)
  expect(h.optimization.runs.map(({ cancel }) => cancel.mock.calls.length), label).toEqual(runCancels)
}

/** An in-memory start reader over orchestration fixtures (the state of each read is the next scenario of the queue). */
function memoryReader(...reads: (OrchestrationScenario | BuildListOptimizationStartPreparation | Error | (() => Promise<BuildListOptimizationStartPreparation>))[]): BuildListOptimizationStartReader & { read: ReturnType<typeof vi.fn> } {
  let index = 0
  return {
    read: vi.fn(async () => {
      const next = reads[Math.min(index, reads.length - 1)]!
      index += 1
      if (next instanceof Error) throw next
      if (typeof next === 'function') return next()
      if ('status' in next) return next
      return {
        status: 'ready',
        plannerInput: { ...next.input, options: { ...defaultPlannerOptions }, conflictResolutions: [] },
        startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true },
      } satisfies BuildListOptimizationStartPreparation
    }),
  }
}

/** The fixture Engine's dependencies (every orchestration scenario shares its Engine version and capability rule). */
const memoryDependencies = (): PlannerDependencies => planCreationScenario([bonusPart('x')]).dependencies

const twoValid = () => planCreationScenario([bonusPart('a'), bonusPart('b')])
const oneValid = () => planCreationScenario([checkpointPart('a')])
const checkpointUnsupported = () => planCreationScenario([checkpointPart('a'), bonusPart('b')])

function primary(state: PlanCreationSessionState) {
  return state.primary
}

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `plan-creation-service-${databaseSequence}-${crypto.randomUUID()}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

/** The `sanity-3` workload (three planning Targets of three weapon types on owned Gogma, the real Master and Production Engine). */
function workload() {
  return createPlannerSchedulerWorkloadInput('sanity-3').input
}

/** Seeds the workload's persisted state with the first `entryCount` of its Entries (every Target stays). */
async function seed(database: AppDatabase, entryCount = 3, plans: ProductionPlan[] = []) {
  const input = workload()
  await database.rngState.put(structuredClone(input.rngState))
  await database.normalArtianCounters.bulkPut(structuredClone(input.normalCounters))
  await database.ownedWeapons.bulkPut(structuredClone(input.ownedWeapons))
  await database.targetWeapons.bulkPut(structuredClone(input.targetWeapons))
  await database.buildListEntries.bulkPut(structuredClone(input.buildListEntries.slice(0, entryCount)))
  if (plans.length > 0) await database.productionPlans.bulkPut(plans)
  return input
}

function plan(id: string, status: ProductionPlan['status']): ProductionPlan {
  return { ...createValidProductionPlan(), id: id as ProductionPlanId, status }
}

/** Every persisted row of every table, to prove that judging and starting wrote nothing. */
async function dumpAll(database: AppDatabase): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, await table.toArray()] as const)))
}

function databaseReader(database: AppDatabase): BuildListOptimizationStartReader {
  return createBuildListOptimizationStartReader(database, master, createBuildListCalculationContext(master))
}

const productionDependencies = () => createProductionPlannerDependencies(new ProductionRngEngine())

// ---------------------------------------------------------------------------------------------------------------------------------

describe('Plan creation preparer over the persisted state (PLANNER_SPEC 17.2 judgements 1 - 6)', () => {
  it('reads one snapshot and judges it, writing nothing: the whole Build List of every weapon type counts and a Draft is no running Plan', async () => {
    await withDatabase(async (database) => {
      const input = await seed(database, 3, [plan('plan.draft', 'draft'), plan('plan.completed', 'completed'), plan('plan.ended', 'abandoned')])
      const before = await dumpAll(database)
      const preparation = await createPlanCreationPreparer({ startReader: databaseReader(database), plannerDependencies: productionDependencies() }).prepare()
      expect(await dumpAll(database)).toEqual(before)
      if (preparation.kind !== 'judged') throw new Error(`expected judged, got ${preparation.kind}`)
      expect(preparation.selection.kind).toBe('build_list_optimization')
      expect(preparation.startSnapshot).toEqual({ observedDraftPlanId: 'plan.draft', runningPlanAbsent: true })
      expect(preparation.plannerInput.conflictResolutions).toEqual([])
      expect(preparation.plannerInput.options).toEqual(defaultPlannerOptions)
      // No display filter exists here: the three Entries of three weapon types are all valid Entries of the judgement.
      expect(new Set(input.targetWeapons.map(({ weaponTypeId }) => weaponTypeId)).size).toBe(3)
      expect(preparation.selection.validation.validBuildListEntries.map(({ entry }) => entry.id).sort()).toEqual(input.buildListEntries.map(({ id }) => id).sort())
    })
  })

  it('offers no new creation beside a running (active or stale) Plan, judging nothing', async () => {
    for (const status of ['active', 'stale'] as const) {
      await withDatabase(async (database) => {
        await seed(database, 3, [plan('plan.running', status), plan('plan.draft', 'draft')])
        const preparation = await createPlanCreationPreparer({ startReader: databaseReader(database), plannerDependencies: productionDependencies() }).prepare()
        expect(preparation).toEqual({ kind: 'running_plan_exists', runningPlanId: 'plan.running' })
      })
    }
  })

  it('fails closed on two Drafts, two running Plans and a read failure, never reading them as none', async () => {
    const cases: [ProductionPlan[], string][] = [
      [[plan('plan.draft.a', 'draft'), plan('plan.draft.b', 'draft')], 'draft_plan_conflict'],
      [[plan('plan.active', 'active'), plan('plan.stale', 'stale')], 'active_plan_conflict'],
    ]
    for (const [plans, code] of cases) {
      await withDatabase(async (database) => {
        await seed(database, 3, plans)
        const preparation = await createPlanCreationPreparer({ startReader: databaseReader(database), plannerDependencies: productionDependencies() }).prepare()
        expect(preparation).toMatchObject({ kind: 'start_read_failed', code })
      })
    }
    await withDatabase(async (database) => {
      await seed(database)
      vi.spyOn(database.buildListEntries, 'toArray').mockRejectedValueOnce(new Error('disk gone'))
      const preparation = await createPlanCreationPreparer({ startReader: databaseReader(database), plannerDependencies: productionDependencies() }).prepare()
      expect(preparation).toMatchObject({ kind: 'start_read_failed', code: 'transaction_failed' })
    })
  })

  it('reports a broken judgement contract as a judgement failure, never as an unsupported input', async () => {
    const built = twoValid()
    const reader = memoryReader({ status: 'ready', plannerInput: { ...built.input, conflictResolutions: [{ conflictKey: 'conflict.x', selectedBuildListEntryId: built.input.buildListEntries[0]!.id }] }, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    const preparation = await createPlanCreationPreparer({ startReader: reader, plannerDependencies: built.dependencies }).prepare()
    expect(preparation.kind).toBe('judgement_failed')
  })
})

describe('Plan creation session over the persisted state: the method the press judged, on the input it judged', () => {
  it('starts the optimization for two or more valid Entries on the judged input and snapshot, with the default options whatever the setting', async () => {
    for (const plannerOptions of [{ maxPlanSteps: 50 }, null, { maxPlanSteps: 0 }]) {
      await withDatabase(async (database) => {
        await seed(database, 3, [plan('plan.draft', 'draft')])
        const before = await dumpAll(database)
        const reader = databaseReader(database)
        const read = vi.spyOn(reader, 'read')
        const h = harness(reader, productionDependencies())
        void h.session.start({ plannerOptions })
        await vi.waitFor(() => expect(h.optimization.runs).toHaveLength(1))
        // One read per press, and the optimization calculates exactly the input the judgement read (never a second read).
        expect(read).toHaveBeenCalledTimes(1)
        expect(h.optimizationOwnReader).not.toHaveBeenCalled()
        const judged = h.preparations[0]!
        if (judged.kind !== 'judged') throw new Error(judged.kind)
        expect(h.optimization.runs).toHaveLength(1)
        expect(h.optimization.runs[0]!.input).toBe(judged.plannerInput)
        expect(h.optimization.runs[0]!.input.options).toEqual(defaultPlannerOptions)
        expect(h.planner.client.createPlan).not.toHaveBeenCalled()
        expect(h.createPlannerClient).not.toHaveBeenCalled()
        expect(primary(h.session.getState())).toMatchObject({ status: 'build_list_optimization', runId: 1, optimization: { status: 'running', startSnapshot: judged.startSnapshot } })
        // Judging and starting wrote nothing.
        expect(await dumpAll(database)).toEqual(before)
        h.session.dispose()
      })
    }
  })

  it('runs the ordinary Planner for one valid Entry with the user setting only, on the judged input', async () => {
    await withDatabase(async (database) => {
      await seed(database, 1)
      const before = await dumpAll(database)
      const h = harness(databaseReader(database), productionDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 50 } })
      await vi.waitFor(() => expect(h.planner.calls).toHaveLength(1))
      const judged = h.preparations[0]!
      if (judged.kind !== 'judged') throw new Error(judged.kind)
      expect(judged.selection.kind).toBe('ordinary_planner')
      expect(h.planner.calls).toHaveLength(1)
      const call = h.planner.calls[0]!
      expect(call.input).toEqual({ ...judged.plannerInput, options: { maxPlanSteps: 50 } })
      // The Build List's own Entries (Routes, selections, preferences) exactly as judged: no optimization artifact, no replacement.
      expect(call.input.buildListEntries).toBe(judged.plannerInput.buildListEntries)
      expect(h.createOptimizationClient).not.toHaveBeenCalled()
      expect(primary(h.session.getState())).toEqual({ status: 'ordinary_planner', runId: 1, run: { status: 'running', requestId: 'planner-request-1' } })
      call.resolve(PLANNER_RESULT)
      expect(primary(await finished)).toEqual({ status: 'ordinary_planner', runId: 1, run: { status: 'completed', requestId: 'planner-request-1', result: PLANNER_RESULT } })
      expect(await dumpAll(database)).toEqual(before)
    })
  })

  it('starts no ordinary Planner on an invalid setting and never fills in a default', async () => {
    for (const plannerOptions of [null, { maxPlanSteps: 0 }, { maxPlanSteps: 1.5 }, { maxPlanSteps: Number.NaN }]) {
      await withDatabase(async (database) => {
        await seed(database, 1)
        const h = harness(databaseReader(database), productionDependencies())
        const state = await h.session.start({ plannerOptions })
        expect(primary(state)).toEqual({ status: 'not_started', runId: 1, reason: { kind: 'planner_options_invalid' } })
        expect(h.createPlannerClient).not.toHaveBeenCalled()
        expect(h.createOptimizationClient).not.toHaveBeenCalled()
      })
    }
  })

  it('re-reads at every press: one Entry becoming two starts the optimization, two becoming one the ordinary Planner', async () => {
    await withDatabase(async (database) => {
      const input = await seed(database, 1)
      const h = harness(databaseReader(database), productionDependencies())
      void h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await vi.waitFor(() => expect(h.planner.calls).toHaveLength(1))
      expect(h.optimization.runs).toHaveLength(0)
      // The Build List gains an Entry after the screen was loaded: the next press reads it.
      await database.buildListEntries.put(structuredClone(input.buildListEntries[1]!))
      void h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await vi.waitFor(() => expect(h.optimization.runs).toHaveLength(1))
      expect(h.planner.client.cancelPlan).toHaveBeenCalledWith('planner-request-1')
      expect(h.optimization.runs[0]!.input.buildListEntries).toHaveLength(2)
      // And loses it again: the ordinary Planner, the optimization run superseded.
      await database.buildListEntries.delete(input.buildListEntries[1]!.id)
      void h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await vi.waitFor(() => expect(h.planner.calls).toHaveLength(2))
      expect(h.optimization.runs[0]!.cancel).toHaveBeenCalledTimes(1)
      expect(h.planner.calls[1]!.input.buildListEntries.map(({ id }) => id)).toEqual([input.buildListEntries[0]!.id])
      expect(primary(h.session.getState())).toMatchObject({ status: 'ordinary_planner', runId: 3, run: { status: 'running' } })
      h.session.dispose()
    })
  })

  it('starts nothing beside a running Plan or when the state cannot be read, and offers no auxiliary operation there', async () => {
    for (const status of ['active', 'stale'] as const) {
      await withDatabase(async (database) => {
        await seed(database, 3, [plan('plan.running', status)])
        const h = harness(databaseReader(database), productionDependencies())
        expect(primary(await h.session.start({ plannerOptions: { maxPlanSteps: 40 } }))).toEqual({ status: 'not_started', runId: 1, reason: { kind: 'running_plan_exists', runningPlanId: 'plan.running' } })
        expect(h.createPlannerClient).not.toHaveBeenCalled()
        expect(h.createOptimizationClient).not.toHaveBeenCalled()
        await expectAuxiliaryRefused(h, `running ${status} Plan`)
      })
    }
    await withDatabase(async (database) => {
      await seed(database, 3, [plan('plan.draft.a', 'draft'), plan('plan.draft.b', 'draft')])
      const h = harness(databaseReader(database), productionDependencies())
      expect(primary(await h.session.start({ plannerOptions: { maxPlanSteps: 40 } }))).toMatchObject({ status: 'not_started', reason: { kind: 'start_read_failed', code: 'draft_plan_conflict' } })
      expect(h.createPlannerClient).not.toHaveBeenCalled()
      expect(h.createOptimizationClient).not.toHaveBeenCalled()
      await expectAuxiliaryRefused(h, 'two Drafts')
    })
  })

  it('re-reads at an offered auxiliary press: a running Plan that appeared since the optimization result starts nothing', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      const h = harness(databaseReader(database), productionDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await vi.waitFor(() => expect(h.optimization.runs).toHaveLength(1))
      h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
      await finished
      expect(isOrdinaryPlannerAuxiliaryOffered(h.session.getState())).toBe(true)
      // Offered, but the state read at the press holds a running Plan: the ordinary Planner cannot run, so nothing starts.
      await database.productionPlans.put(plan('plan.running', 'active'))
      const state = await h.pressAuxiliary()
      expect(h.prepare).toHaveBeenCalledTimes(2)
      expect(state.auxiliary).toEqual({ status: 'not_started', runId: 2, reason: { kind: 'running_plan_exists', runningPlanId: 'plan.running' } })
      expect(h.createPlannerClient).not.toHaveBeenCalled()
      expect(primary(state)).toMatchObject({ status: 'build_list_optimization', optimization: { status: 'completed', completion: { result: NOT_FOUND } } })
    })
  })
})

describe('Plan creation session lifecycle: no automatic fallback, superseded presses and release', () => {
  it('never starts the ordinary Planner from an optimization outcome: cancel, not found, search bound, unsupported, failure, optimized', async () => {
    const outcomes: { settle: BuildListOptimizationRunOutcome | 'cancel'; offered: boolean }[] = [
      { settle: 'cancel', offered: false },
      { settle: { status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND }, offered: true },
      { settle: { status: 'completed', requestId: 'optimization-run-1', result: SEARCH_BOUND }, offered: true },
      { settle: { status: 'completed', requestId: 'optimization-run-1', result: { status: 'unsupported', reasons: [{ kind: 'checkpoint_selection', entries: [] }] } }, offered: true },
      { settle: { status: 'completed', requestId: 'optimization-run-1', result: { status: 'unsupported', reasons: [{ kind: 'invalid_planner_input', issues: [] }] } }, offered: false },
      { settle: { status: 'failed', requestId: 'optimization-run-1', failure: { kind: 'worker_error', message: null } }, offered: false },
      { settle: { status: 'failed', requestId: 'optimization-run-1', failure: { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'broken' } }, offered: false },
      { settle: { status: 'completed', requestId: 'optimization-run-1', result: { status: 'optimized', artifact: { marker: 'artifact' } as never } }, offered: false },
    ]
    for (const { settle, offered } of outcomes) {
      const h = harness(memoryReader(twoValid()), memoryDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await flush()
      expect(h.optimization.runs).toHaveLength(1)
      if (settle === 'cancel') h.session.cancel()
      else h.optimization.runs[0]!.settle(settle)
      const state = await finished
      await flush()
      expect(primary(state).status).toBe('build_list_optimization')
      expect(h.createPlannerClient).not.toHaveBeenCalled()
      expect(h.planner.client.createPlan).not.toHaveBeenCalled()
      expect(h.preparations).toHaveLength(1)
      expect(isOrdinaryPlannerAuxiliaryOffered(state), JSON.stringify(settle)).toBe(offered)
    }
  })

  it('keeps an optimized artifact with its start snapshot for the adoption, and never offers the auxiliary beside it', async () => {
    const h = harness(memoryReader(twoValid()), memoryDependencies())
    const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: { status: 'optimized', artifact: { marker: 'artifact' } as never } })
    const state = await finished
    const current = primary(state)
    if (current.status !== 'build_list_optimization') throw new Error(current.status)
    expect(buildListOptimizationAdoptionSourceOf(current.optimization)).toEqual({ artifact: { marker: 'artifact' }, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    expect(isOrdinaryPlannerAuxiliaryOffered(state)).toBe(false)
  })

  it('follows the optimization stages while it runs', async () => {
    const h = harness(memoryReader(twoValid()), memoryDependencies())
    void h.session.start({ plannerOptions: null })
    await flush()
    for (const stage of ['input_check', 'reach_table'] as BuildListOptimizationStage[]) h.optimization.runs[0]!.observer!.onStage!(stage)
    expect(primary(h.session.getState())).toMatchObject({ status: 'build_list_optimization', optimization: { status: 'running', stage: 'reach_table' } })
    h.session.dispose()
  })

  it('runs the auxiliary ordinary Planner only on its press, reading afresh, and keeps the result it was offered beside', async () => {
    const h = harness(memoryReader(twoValid(), twoValid()), memoryDependencies())
    const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    await finished
    expect(h.planner.client.createPlan).not.toHaveBeenCalled()
    expect(isOrdinaryPlannerAuxiliaryOffered(h.session.getState())).toBe(true)

    const auxiliary = h.session.startOrdinaryPlanner({ plannerOptions: { maxPlanSteps: 60 } })
    await flush()
    expect(h.preparations).toHaveLength(2)
    const judged = h.preparations[1]!
    if (judged.kind !== 'judged') throw new Error(judged.kind)
    // Two valid Entries would choose the optimization; the auxiliary operation runs the ordinary Planner on them instead.
    expect(judged.selection.kind).toBe('build_list_optimization')
    expect(h.planner.calls).toHaveLength(1)
    expect(h.planner.calls[0]!.input).toEqual({ ...judged.plannerInput, options: { maxPlanSteps: 60 } })
    expect(h.optimization.runs).toHaveLength(1)
    // The not_found it was offered beside stays, and the offer stays while the ordinary Planner runs and after it ends.
    expect(primary(h.session.getState())).toMatchObject({ status: 'build_list_optimization', optimization: { status: 'completed', completion: { result: NOT_FOUND } } })
    expect(h.session.getState().auxiliary).toEqual({ status: 'ordinary_planner', runId: 2, run: { status: 'running', requestId: 'planner-request-1' } })
    h.planner.calls[0]!.resolve(PLANNER_RESULT)
    const state = await auxiliary
    expect(state.auxiliary).toEqual({ status: 'ordinary_planner', runId: 2, run: { status: 'completed', requestId: 'planner-request-1', result: PLANNER_RESULT } })
    expect(isOrdinaryPlannerAuxiliaryOffered(state)).toBe(true)
    // A new primary press drops both.
    void h.session.start({ plannerOptions: { maxPlanSteps: 60 } })
    expect(h.session.getState()).toEqual({ primary: { status: 'preparing', runId: 3 }, auxiliary: { status: 'idle' } })
    h.session.dispose()
  })

  it('starts no Worker for an unsupported input known before the start, and the auxiliary keeps every selection as a hard constraint', async () => {
    const built = checkpointUnsupported()
    const h = harness(memoryReader(built, checkpointUnsupported()), memoryDependencies())
    const state = await h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    expect(primary(state)).toMatchObject({
      status: 'not_started',
      reason: { kind: 'build_list_optimization_unsupported', reasons: [{ kind: 'checkpoint_selection', entries: [{ buildListEntryId: 'build-list.method.a' }] }], ordinaryPlannerAuxiliary: true },
    })
    expect(h.createOptimizationClient).not.toHaveBeenCalled()
    expect(h.createPlannerClient).not.toHaveBeenCalled()
    expect(isOrdinaryPlannerAuxiliaryOffered(state)).toBe(true)
    void h.session.startOrdinaryPlanner({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    expect(h.planner.calls).toHaveLength(1)
    expect(h.planner.calls[0]!.input.buildListEntries).toEqual(built.input.buildListEntries)
    expect(h.planner.calls[0]!.input.buildListEntries[0]!.intermediateStateSelection?.bonusOpportunityId).not.toBeNull()
    expect(h.createOptimizationClient).not.toHaveBeenCalled()
    h.session.dispose()
  })

  it('starts no auxiliary run when the ordinary Planner cannot run on the state read at the press, or on an invalid setting', async () => {
    const cases: { read: OrchestrationScenario | BuildListOptimizationStartPreparation | Error; reason: string }[] = [
      { read: { status: 'running_plan_exists', runningPlanId: 'plan.running' as ProductionPlanId }, reason: 'running_plan_exists' },
      { read: new RepositoryError('active_plan_conflict', 'two running Plans'), reason: 'start_read_failed' },
      { read: legacyDuplicateScenario(), reason: 'invalid_planner_input' },
      { read: planCreationScenario([]), reason: 'no_valid_build_list_entry' },
    ]
    for (const { read, reason } of cases) {
      const h = harness(memoryReader(twoValid(), read), memoryDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await flush()
      h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
      await finished
      const state = await h.session.startOrdinaryPlanner({ plannerOptions: { maxPlanSteps: 40 } })
      expect(state.auxiliary).toMatchObject({ status: 'not_started', reason: { kind: reason } })
      expect(h.createPlannerClient).not.toHaveBeenCalled()
      // The result it was offered beside stays.
      expect(primary(state)).toMatchObject({ status: 'build_list_optimization', optimization: { status: 'completed' } })
    }
    const h = harness(memoryReader(twoValid(), twoValid()), memoryDependencies())
    const finished = h.session.start({ plannerOptions: null })
    await flush()
    h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: SEARCH_BOUND })
    await finished
    expect((await h.session.startOrdinaryPlanner({ plannerOptions: null })).auxiliary).toEqual({ status: 'not_started', runId: 2, reason: { kind: 'planner_options_invalid' } })
    expect(h.createPlannerClient).not.toHaveBeenCalled()
  })

  it('never lets an earlier press, read or judgement overwrite a later one', async () => {
    const slow = deferred<BuildListOptimizationStartPreparation>()
    const reader = memoryReader(() => slow.promise, twoValid())
    const h = harness(reader, memoryDependencies())
    const first = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    expect(primary(h.session.getState())).toEqual({ status: 'preparing', runId: 1 })
    const second = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    expect(h.optimization.runs).toHaveLength(1)
    // The first read arrives late, for one valid Entry: it starts nothing.
    const late = oneValid()
    slow.resolve({ status: 'ready', plannerInput: { ...late.input, options: { ...defaultPlannerOptions } }, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    await first
    expect(h.planner.client.createPlan).not.toHaveBeenCalled()
    expect(primary(h.session.getState())).toMatchObject({ status: 'build_list_optimization', runId: 2, optimization: { status: 'running' } })
    h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    expect(primary(await second)).toMatchObject({ status: 'build_list_optimization', runId: 2, optimization: { status: 'completed' } })

    // An offered auxiliary press supersedes the auxiliary run still going (a re-run), never the result it was offered beside.
    const firstAuxiliary = h.pressAuxiliary()
    await flush()
    const secondAuxiliary = h.pressAuxiliary()
    expect(h.planner.client.cancelPlan).toHaveBeenCalledWith('planner-request-1')
    await flush()
    expect(h.planner.calls).toHaveLength(2)
    h.planner.calls[0]!.resolve(PLANNER_RESULT)
    await firstAuxiliary
    expect(h.session.getState().auxiliary).toEqual({ status: 'ordinary_planner', runId: 4, run: { status: 'running', requestId: 'planner-request-2' } })
    h.planner.calls[1]!.resolve(PLANNER_RESULT)
    expect((await secondAuxiliary).auxiliary).toEqual({ status: 'ordinary_planner', runId: 4, run: { status: 'completed', requestId: 'planner-request-2', result: PLANNER_RESULT } })
    expect(primary(h.session.getState())).toMatchObject({ status: 'build_list_optimization', runId: 2, optimization: { status: 'completed', completion: { result: NOT_FOUND } } })
  })

  it('cancels a press while it reads, and an ordinary Planner run through its request, ignoring what arrives later', async () => {
    const slow = deferred<BuildListOptimizationStartPreparation>()
    const h = harness(memoryReader(() => slow.promise, oneValid()), memoryDependencies())
    const reading = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    h.session.cancel()
    expect(primary(h.session.getState())).toEqual({ status: 'cancelled', runId: 1, reason: 'cancelled' })
    slow.resolve({ status: 'ready', plannerInput: { ...oneValid().input, options: { ...defaultPlannerOptions } }, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    await reading
    expect(h.createPlannerClient).not.toHaveBeenCalled()
    expect(h.createOptimizationClient).not.toHaveBeenCalled()

    const running = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    expect(h.planner.calls).toHaveLength(1)
    h.session.cancel()
    expect(h.planner.client.cancelPlan).toHaveBeenCalledWith('planner-request-1')
    expect(primary(h.session.getState())).toEqual({ status: 'ordinary_planner', runId: 2, run: { status: 'cancelled', requestId: 'planner-request-1', reason: 'cancelled' } })
    // A result arriving after the cancel is never applied, and the cancel starts no other calculation.
    h.planner.calls[0]!.resolve(PLANNER_RESULT)
    await running
    expect(primary(h.session.getState())).toMatchObject({ run: { status: 'cancelled' } })
    expect(h.createOptimizationClient).not.toHaveBeenCalled()
  })

  it('keeps an ordinary Planner failure a failure, and recreates a Client that could not be created', async () => {
    const h = harness(memoryReader(oneValid()), memoryDependencies())
    const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.planner.calls[0]!.reject(new Error('Planner Worker failed.'))
    expect(primary(await finished)).toEqual({ status: 'ordinary_planner', runId: 1, run: { status: 'failed', requestId: 'planner-request-1', message: 'Planner Worker failed.' } })
    expect(h.createOptimizationClient).not.toHaveBeenCalled()
    expect(isOrdinaryPlannerAuxiliaryOffered(h.session.getState())).toBe(false)

    const healthy = fakePlannerClient()
    const createPlannerClient = vi.fn<() => PlannerWorkerClient>().mockImplementationOnce(() => {
      throw new Error('no Worker')
    }).mockReturnValue(healthy.client)
    const session = createPlanCreationSession({
      preparer: createPlanCreationPreparer({ startReader: memoryReader(oneValid()), plannerDependencies: memoryDependencies() }),
      optimization: createBuildListOptimizationSession({ startReader: { read: vi.fn() }, createClient: vi.fn() }),
      createPlannerClient,
      createRequestId: () => 'request',
    })
    expect(primary(await session.start({ plannerOptions: { maxPlanSteps: 40 } }))).toEqual({ status: 'ordinary_planner', runId: 1, run: { status: 'failed', requestId: null, message: 'no Worker' } })
    void session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    expect(createPlannerClient).toHaveBeenCalledTimes(2)
    expect(healthy.calls).toHaveLength(1)
    session.dispose()
  })

  it('discards back to idle, cancelling what runs', async () => {
    const h = harness(memoryReader(twoValid()), memoryDependencies())
    void h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.session.discard()
    expect(h.optimization.runs[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(h.session.getState()).toEqual({ primary: { status: 'idle' }, auxiliary: { status: 'idle' } })
    expect(h.createPlannerClient).not.toHaveBeenCalled()
  })

  it('disposes: cancels, releases both Clients and starts nothing afterwards, reading nothing', async () => {
    const reader = memoryReader(oneValid(), twoValid())
    const h = harness(reader, memoryDependencies())
    void h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.session.dispose()
    expect(h.planner.client.cancelPlan).toHaveBeenCalledWith('planner-request-1')
    expect(h.planner.client.dispose).toHaveBeenCalledTimes(1)
    expect(h.session.getState()).toEqual({ primary: { status: 'disposed' }, auxiliary: { status: 'disposed' } })
    expect(await h.session.start({ plannerOptions: { maxPlanSteps: 40 } })).toEqual({ primary: { status: 'disposed' }, auxiliary: { status: 'disposed' } })
    expect(await h.session.startOrdinaryPlanner({ plannerOptions: { maxPlanSteps: 40 } })).toEqual({ primary: { status: 'disposed' }, auxiliary: { status: 'disposed' } })
    expect(reader.read).toHaveBeenCalledTimes(1)
    expect(h.planner.calls).toHaveLength(1)
    expect(h.createOptimizationClient).not.toHaveBeenCalled()

    // A running optimization is cancelled and its Client released too.
    const other = harness(memoryReader(twoValid()), memoryDependencies())
    void other.session.start({ plannerOptions: null })
    await flush()
    other.session.dispose()
    expect(other.optimization.runs[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(other.optimization.client.dispose).toHaveBeenCalledTimes(1)
  })

  it('refuses the auxiliary operation outside the offer before any side effect (PLANNER_SPEC 17.2)', async () => {
    // The initial state.
    await expectAuxiliaryRefused(harness(memoryReader(twoValid()), memoryDependencies()), 'initial')

    // The primary press chose the ordinary Planner: running, then completed. The running run is never cancelled by the refusal.
    const ordinary = harness(memoryReader(oneValid()), memoryDependencies())
    const ordinaryRun = ordinary.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    await expectAuxiliaryRefused(ordinary, 'primary ordinary Planner running')
    expect(primary(ordinary.session.getState())).toEqual({ status: 'ordinary_planner', runId: 1, run: { status: 'running', requestId: 'planner-request-1' } })
    ordinary.planner.calls[0]!.resolve(PLANNER_RESULT)
    await ordinaryRun
    await expectAuxiliaryRefused(ordinary, 'primary ordinary Planner completed')
    expect(ordinary.planner.calls).toHaveLength(1)

    // The primary press is still reading and judging: it goes on to the optimization after the refusal.
    const slow = deferred<BuildListOptimizationStartPreparation>()
    const reading = harness(memoryReader(() => slow.promise), memoryDependencies())
    const readingRun = reading.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await expectAuxiliaryRefused(reading, 'primary press reading')
    slow.resolve({ status: 'ready', plannerInput: { ...twoValid().input, options: { ...defaultPlannerOptions } }, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    await flush()
    expect(reading.optimization.runs).toHaveLength(1)
    expect(primary(reading.session.getState())).toMatchObject({ status: 'build_list_optimization', runId: 1, optimization: { status: 'running' } })
    reading.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    expect(primary(await readingRun)).toMatchObject({ status: 'build_list_optimization', runId: 1, optimization: { status: 'completed' } })

    // The optimization is preparing (the session's own preparing, before its Worker run starts).
    const preparing = harness(memoryReader(twoValid()), memoryDependencies())
    let refusedWhilePreparing: { press: Promise<PlanCreationSessionState>; before: PlanCreationSessionState } | null = null
    preparing.session.subscribe((state) => {
      const current = state.primary
      if (refusedWhilePreparing === null && current.status === 'build_list_optimization' && current.optimization.status === 'preparing') {
        refusedWhilePreparing = { press: preparing.pressAuxiliary(), before: state }
      }
    })
    const preparingRun = preparing.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    expect(refusedWhilePreparing).not.toBeNull()
    expect(await refusedWhilePreparing!.press).toBe(refusedWhilePreparing!.before)
    expect(preparing.prepare).toHaveBeenCalledTimes(1)
    expect(preparing.createPlannerClient).not.toHaveBeenCalled()
    expect(preparing.optimization.runs).toHaveLength(1)
    expect(preparing.optimization.runs[0]!.cancel).not.toHaveBeenCalled()
    expect(preparing.session.getState().auxiliary).toEqual({ status: 'idle' })

    // The optimization is running: the refusal never cancels it, and its result arrives as usual.
    await expectAuxiliaryRefused(preparing, 'optimization running')
    expect(primary(preparing.session.getState())).toMatchObject({ status: 'build_list_optimization', runId: 1, optimization: { status: 'running' } })
    preparing.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: SEARCH_BOUND })
    expect(primary(await preparingRun)).toMatchObject({ status: 'build_list_optimization', optimization: { status: 'completed', completion: { result: SEARCH_BOUND } } })
    expect(isOrdinaryPlannerAuxiliaryOffered(preparing.session.getState())).toBe(true)

    // The optimization ended without an offer: optimized, cancelled, a Worker failure, a contract violation, and an unsupported
    // result holding a reason the ordinary Planner cannot run despite (alone or beside an allowed one).
    const unoffered: [string, BuildListOptimizationRunOutcome | 'cancel'][] = [
      ['optimized', { status: 'completed', requestId: 'optimization-run-1', result: { status: 'optimized', artifact: { marker: 'artifact' } as never } }],
      ['cancelled', 'cancel'],
      ['Worker failure', { status: 'failed', requestId: 'optimization-run-1', failure: { kind: 'worker_error', message: null } }],
      ['contract violation', { status: 'failed', requestId: 'optimization-run-1', failure: { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'broken' } }],
      ['unsupported (blocking)', { status: 'completed', requestId: 'optimization-run-1', result: { status: 'unsupported', reasons: [{ kind: 'invalid_planner_input', issues: [] }] } }],
      ['unsupported (mixed)', { status: 'completed', requestId: 'optimization-run-1', result: { status: 'unsupported', reasons: [{ kind: 'checkpoint_selection', entries: [] }, { kind: 'no_planning_target' }] } }],
    ]
    for (const [label, settle] of unoffered) {
      const h = harness(memoryReader(twoValid()), memoryDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await flush()
      if (settle === 'cancel') h.session.cancel()
      else h.optimization.runs[0]!.settle(settle)
      await finished
      await expectAuxiliaryRefused(h, label)
    }

    // A primary press that started nothing for a reason that stops the ordinary Planner too, or for an invalid setting.
    const notStarted: [string, OrchestrationScenario | BuildListOptimizationStartPreparation | Error][] = [
      ['invalid input', legacyDuplicateScenario()],
      ['no valid Entry', planCreationScenario([])],
      ['running Plan', { status: 'running_plan_exists', runningPlanId: 'plan.running' as ProductionPlanId }],
      ['read failure', new RepositoryError('draft_plan_conflict', 'two Drafts')],
      ['invalid setting with one valid Entry', oneValid()],
    ]
    for (const [label, read] of notStarted) {
      const h = harness(memoryReader(read), memoryDependencies())
      expect(primary(await h.session.start({ plannerOptions: null })).status, label).toBe('not_started')
      await expectAuxiliaryRefused(h, label)
    }

    // A discarded offer, and a disposed session.
    const discarded = harness(memoryReader(twoValid()), memoryDependencies())
    const discardedRun = discarded.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    discarded.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    await discardedRun
    expect(isOrdinaryPlannerAuxiliaryOffered(discarded.session.getState())).toBe(true)
    discarded.session.discard()
    await expectAuxiliaryRefused(discarded, 'discarded')
    const disposed = harness(memoryReader(twoValid()), memoryDependencies())
    const disposedRun = disposed.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    disposed.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    await disposedRun
    disposed.session.dispose()
    await expectAuxiliaryRefused(disposed, 'disposed')
  })

  it('starts the auxiliary operation from every offer: pre-start unsupported, not found, search bound and an allowed unsupported result', async () => {
    const offers: [string, BuildListOptimizationResult][] = [
      ['not_found', NOT_FOUND],
      ['search_bound_reached', SEARCH_BOUND],
      ['unsupported (allowed reasons)', { status: 'unsupported', reasons: [{ kind: 'unconfirmed_rng_state', missing: ['skill_counter'] }, { kind: 'target_without_source', targetWeaponIds: [] }, { kind: 'blind_route_required', targetWeaponIds: [] }] }],
    ]
    for (const [label, result] of offers) {
      const h = harness(memoryReader(twoValid(), checkpointUnsupported()), memoryDependencies())
      const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
      await flush()
      h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result })
      await finished
      expect(isOrdinaryPlannerAuxiliaryOffered(h.session.getState()), label).toBe(true)
      void h.pressAuxiliary()
      await flush()
      // A fresh read and judgement at the press, then the ordinary Planner on that input with the user's setting.
      expect(h.prepare, label).toHaveBeenCalledTimes(2)
      const judged = h.preparations[1]!
      if (judged.kind !== 'judged') throw new Error(judged.kind)
      expect(h.planner.calls, label).toHaveLength(1)
      expect(h.planner.calls[0]!.input, label).toEqual({ ...judged.plannerInput, options: { maxPlanSteps: 40 } })
      expect(h.optimization.runs, label).toHaveLength(1)
      h.session.dispose()
    }
    // The pre-start unsupported offer is covered with the selection kept as a hard constraint above; here it is pressed directly.
    const prestart = harness(memoryReader(checkpointUnsupported()), memoryDependencies())
    expect(primary(await prestart.session.start({ plannerOptions: { maxPlanSteps: 40 } }))).toMatchObject({ status: 'not_started', reason: { kind: 'build_list_optimization_unsupported' } })
    expect((await (async () => {
      const press = prestart.pressAuxiliary()
      await flush()
      prestart.planner.calls[0]!.resolve(PLANNER_RESULT)
      return press
    })()).auxiliary).toEqual({ status: 'ordinary_planner', runId: 2, run: { status: 'completed', requestId: 'planner-request-1', result: PLANNER_RESULT } })
  })

  it('runs the auxiliary operation again after an incomplete search, no Plan, a cancel or a failure while its offer stays', async () => {
    const incomplete = { termination: { status: 'incomplete' }, plan: { marker: 'partial' } } as unknown as PlannerResult
    const noPlan = { termination: { status: 'exhausted' }, plan: null } as unknown as PlannerResult
    const h = harness(memoryReader(twoValid()), memoryDependencies())
    const finished = h.session.start({ plannerOptions: { maxPlanSteps: 40 } })
    await flush()
    h.optimization.runs[0]!.settle({ status: 'completed', requestId: 'optimization-run-1', result: NOT_FOUND })
    await finished
    const basis = primary(h.session.getState())

    const ends: [string, (index: number) => void][] = [
      ['incomplete search', (index) => h.planner.calls[index]!.resolve(incomplete)],
      ['no Plan', (index) => h.planner.calls[index]!.resolve(noPlan)],
      ['cancelled', () => h.session.cancel()],
      ['failed', (index) => h.planner.calls[index]!.reject(new Error('Planner Worker failed.'))],
    ]
    for (const [index, [label, end]] of ends.entries()) {
      expect(isOrdinaryPlannerAuxiliaryOffered(h.session.getState()), label).toBe(true)
      const press = h.pressAuxiliary()
      await flush()
      expect(h.planner.calls, label).toHaveLength(index + 1)
      expect(h.planner.calls[index]!.input.options, label).toEqual({ maxPlanSteps: 40 })
      end(index)
      const state = await press
      expect(state.auxiliary.status, label).toBe('ordinary_planner')
      // The optimization result the offer stands on is untouched, never re-run, and its Worker never restarted.
      expect(primary(state), label).toBe(basis)
      expect(h.optimization.runs, label).toHaveLength(1)
    }
    expect(h.prepare).toHaveBeenCalledTimes(5)
    h.session.dispose()
  })

  it('inspects the current judgement for the display without changing the session state or starting anything', async () => {
    const h = harness(memoryReader(checkpointUnsupported()), memoryDependencies())
    const inspection = await h.session.inspect()
    expect(inspection).toMatchObject({ kind: 'judged', selection: { kind: 'build_list_optimization_unsupported', ordinaryPlannerAuxiliary: true } })
    expect(h.session.getState()).toEqual({ primary: { status: 'idle' }, auxiliary: { status: 'idle' } })
    expect(h.states).toEqual([])
    expect(h.createPlannerClient).not.toHaveBeenCalled()
    expect(h.createOptimizationClient).not.toHaveBeenCalled()
  })
})
