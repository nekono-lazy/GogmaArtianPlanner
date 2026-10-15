import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import type { ProductionPlan, ProductionPlanId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner'
import type { BuildListOptimizationResult, BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import { createBuildListOptimizationTestInput } from '../../test/fixtures/buildListOptimizationWorkerFixtures'
import {
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createBuildListCalculationContext } from '../buildList/createBuildListCalculationContext'
import {
  buildListOptimizationAdoptionSourceOf,
  createBuildListOptimizationSession,
  createBuildListOptimizationStartReader,
  type BuildListOptimizationSessionState,
  type BuildListOptimizationStartPreparation,
  type BuildListOptimizationStartReader,
} from './buildListOptimizationService'
import type {
  BuildListOptimizationRunHandle,
  BuildListOptimizationRunObserver,
  BuildListOptimizationRunOutcome,
  BuildListOptimizationWorkerClient,
} from './buildListOptimizationWorkerClient'
import { createPlannerInput } from './createPlannerInput'

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `build-list-optimization-service-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function plan(id: string, status: ProductionPlan['status']): ProductionPlan {
  return { ...createValidProductionPlan(), id: id as ProductionPlanId, status }
}

async function seed(database: AppDatabase, plans: ProductionPlan[] = []) {
  await database.rngState.put(createValidRngState())
  await database.normalArtianCounters.put(createValidNormalArtianCounter())
  await database.ownedWeapons.put(createValidOwnedWeapon())
  await database.targetWeapons.put(createValidTargetWeapon())
  await database.buildListEntries.put(createValidBuildListEntry())
  if (plans.length > 0) await database.productionPlans.bulkPut(plans)
}

/** Every persisted row of every table, to prove a read wrote nothing. */
async function dump(database: AppDatabase): Promise<Record<string, unknown[]>> {
  const entries = await Promise.all(database.tables.map(async table => [table.name, await table.toArray()] as const))
  return Object.fromEntries(entries)
}

function reader(database: AppDatabase): BuildListOptimizationStartReader {
  const master = createValidMasterDataFixture()
  return createBuildListOptimizationStartReader(database, master, createBuildListCalculationContext(master))
}

describe('Build List optimization start reader', () => {
  it('reads the fresh input with no conflict resolution and the current Draft ID, and writes nothing', async () => {
    await withDatabase(async (database) => {
      await seed(database, [plan('plan.draft', 'draft'), plan('plan.completed', 'completed'), plan('plan.ended', 'abandoned')])
      const before = await dump(database)
      const preparation = await reader(database).read()
      expect(await dump(database)).toEqual(before)
      if (preparation.status !== 'ready') throw new Error('expected ready')
      expect(preparation.startSnapshot).toEqual({ observedDraftPlanId: 'plan.draft', runningPlanAbsent: true })
      expect(preparation.plannerInput.conflictResolutions).toEqual([])
      // The ordinary createPlannerInput() value over the same persisted state (no saved Draft, baseSnapshot or lineage is read).
      const master = createValidMasterDataFixture()
      const ordinary = await createPlannerInput(master, createBuildListCalculationContext(master), {
        ensureInitialRngState: async () => (await database.rngState.get('current'))!,
        getAllNormalArtianCounters: () => database.normalArtianCounters.toArray(),
        getAllOwnedWeapons: () => database.ownedWeapons.toArray(),
        getAllTargetWeapons: () => database.targetWeapons.toArray(),
        getAllBuildListEntries: () => database.buildListEntries.toArray(),
      })
      expect(preparation.plannerInput).toEqual(ordinary)
      expect(preparation.plannerInput).not.toHaveProperty('baseSnapshot')
    })
  })

  it('observes no Draft as null, and a Draft beside completed or ended Plans does not refuse the start', async () => {
    await withDatabase(async (database) => {
      await seed(database, [plan('plan.completed', 'completed')])
      const preparation = await reader(database).read()
      expect(preparation).toMatchObject({ status: 'ready', startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } })
    })
  })

  it('refuses the start when a running (active or stale) Plan exists, reading no input for it', async () => {
    for (const status of ['active', 'stale'] as const) {
      await withDatabase(async (database) => {
        await seed(database, [plan('plan.running', status), plan('plan.draft', 'draft')])
        expect(await reader(database).read()).toEqual({ status: 'running_plan_exists', runningPlanId: 'plan.running' })
      })
    }
  })

  it('fails closed on two Drafts, two running Plans and a missing RngState, creating nothing', async () => {
    await withDatabase(async (database) => {
      await seed(database, [plan('plan.draft.a', 'draft'), plan('plan.draft.b', 'draft')])
      await expect(reader(database).read()).rejects.toMatchObject({ name: 'RepositoryError', code: 'draft_plan_conflict' })
    })
    await withDatabase(async (database) => {
      await seed(database, [plan('plan.active', 'active'), plan('plan.stale', 'stale')])
      await expect(reader(database).read()).rejects.toMatchObject({ name: 'RepositoryError', code: 'active_plan_conflict' })
    })
    await withDatabase(async (database) => {
      await seed(database)
      await database.rngState.clear()
      const before = await dump(database)
      await expect(reader(database).read()).rejects.toMatchObject({ name: 'RepositoryError', code: 'not_found' })
      expect(await dump(database)).toEqual(before)
      expect(await database.rngState.count()).toBe(0)
    })
  })

  it('wraps an unexpected read failure as a typed transaction failure', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      vi.spyOn(database.buildListEntries, 'toArray').mockRejectedValueOnce(new Error('disk gone'))
      await expect(reader(database).read()).rejects.toMatchObject({ name: 'RepositoryError', code: 'transaction_failed' })
    })
  })
})

/** A fake Client whose runs settle when the test says so. */
function fakeClient() {
  const runs: { input: PlannerInput; observer?: BuildListOptimizationRunObserver; settle: (outcome: BuildListOptimizationRunOutcome) => void; cancel: ReturnType<typeof vi.fn>; requestId: string }[] = []
  const client: BuildListOptimizationWorkerClient = {
    run: vi.fn((input: PlannerInput, observer?: BuildListOptimizationRunObserver): BuildListOptimizationRunHandle => {
      const requestId = `run-${runs.length + 1}`
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settleResolve, settleReject) => {
    resolve = settleResolve
    reject = settleReject
  })
  return { promise, resolve, reject }
}

const START: BuildListOptimizationStartPreparation = {
  status: 'ready',
  plannerInput: createBuildListOptimizationTestInput(),
  startSnapshot: { observedDraftPlanId: 'plan.draft' as ProductionPlanId, runningPlanAbsent: true },
}

const NOT_FOUND: BuildListOptimizationResult = {
  status: 'not_found', reason: 'candidates_rejected',
  diagnostics: { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 1, elapsedMs: null },
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function sessionWith(read: () => Promise<BuildListOptimizationStartPreparation>) {
  const { client, runs } = fakeClient()
  const createClient = vi.fn(() => client)
  const session = createBuildListOptimizationSession({ startReader: { read: vi.fn(read) }, createClient })
  const states: BuildListOptimizationSessionState[] = []
  session.subscribe(state => states.push(state))
  return { session, runs, client, createClient, states }
}

describe('Build List optimization session', () => {
  it('reads, runs on the Worker Client, follows the stages and keeps the result with its start snapshot', async () => {
    const { session, runs, states } = sessionWith(async () => START)
    const finished = session.start()
    expect(session.getState()).toEqual({ status: 'preparing', runId: 1 })
    await flush()
    expect(runs).toHaveLength(1)
    expect(runs[0]!.input).toBe(START.plannerInput)
    expect(session.getState()).toEqual({ status: 'running', runId: 1, requestId: 'run-1', stage: null, startSnapshot: START.startSnapshot })
    for (const stage of ['input_check', 'reach_table'] as BuildListOptimizationStage[]) runs[0]!.observer!.onStage!(stage)
    expect(session.getState()).toMatchObject({ status: 'running', stage: 'reach_table' })
    runs[0]!.settle({ status: 'completed', requestId: 'run-1', result: NOT_FOUND })
    const state = await finished
    expect(state).toEqual({ status: 'completed', runId: 1, completion: { decidedBy: 'calculation', result: NOT_FOUND, startSnapshot: START.startSnapshot } })
    expect(states.map(value => value.status)).toEqual(['preparing', 'running', 'running', 'running', 'completed'])
    // Not optimized: nothing to adopt.
    expect(buildListOptimizationAdoptionSourceOf(state)).toBeNull()
  })

  it('pairs an optimized artifact with its start snapshot for the adoption', async () => {
    const { session, runs } = sessionWith(async () => START)
    const finished = session.start()
    await flush()
    const artifact = { marker: 'artifact' } as never
    runs[0]!.settle({ status: 'completed', requestId: 'run-1', result: { status: 'optimized', artifact } })
    expect(buildListOptimizationAdoptionSourceOf(await finished)).toEqual({ artifact, startSnapshot: START.startSnapshot })
  })

  it('refuses before any calculation when a running Plan exists', async () => {
    const { session, client, createClient } = sessionWith(async () => ({ status: 'running_plan_exists', runningPlanId: 'plan.running' as ProductionPlanId }))
    const state = await session.start()
    expect(state).toEqual({ status: 'completed', runId: 1, completion: { decidedBy: 'application', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } } })
    expect(createClient).not.toHaveBeenCalled()
    expect(client.run).not.toHaveBeenCalled()
    expect(buildListOptimizationAdoptionSourceOf(state)).toBeNull()
  })

  it('fails closed when the start state cannot be read, calculating nothing', async () => {
    const { session, client } = sessionWith(async () => {
      throw new RepositoryError('draft_plan_conflict', 'two Drafts')
    })
    expect(await session.start()).toEqual({ status: 'failed', runId: 1, failure: { kind: 'start_read_failed', code: 'draft_plan_conflict', message: 'two Drafts' } })
    expect(client.run).not.toHaveBeenCalled()
  })

  it('keeps a Worker failure a failure and never falls back to another calculation', async () => {
    const { session, runs, client } = sessionWith(async () => START)
    const finished = session.start()
    await flush()
    runs[0]!.settle({ status: 'failed', requestId: 'run-1', failure: { kind: 'worker_error', message: null } })
    expect(await finished).toEqual({ status: 'failed', runId: 1, failure: { kind: 'worker_error', message: null } })
    expect(client.run).toHaveBeenCalledTimes(1)
  })

  it('cancels while preparing: the read result is dropped and no Worker starts', async () => {
    const read = deferred<BuildListOptimizationStartPreparation>()
    const { session, client } = sessionWith(() => read.promise)
    const finished = session.start()
    session.cancel()
    expect(session.getState()).toEqual({ status: 'cancelled', runId: 1, reason: 'cancelled' })
    read.resolve(START)
    expect(await finished).toEqual({ status: 'cancelled', runId: 1, reason: 'cancelled' })
    expect(client.run).not.toHaveBeenCalled()
  })

  it('cancels while running synchronously, through the run handle', async () => {
    const { session, runs } = sessionWith(async () => START)
    const finished = session.start()
    await flush()
    session.cancel()
    expect(session.getState()).toEqual({ status: 'cancelled', runId: 1, reason: 'cancelled' })
    expect(runs[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(await finished).toEqual({ status: 'cancelled', runId: 1, reason: 'cancelled' })
  })

  it('never lets an earlier start overwrite a later one', async () => {
    const firstRead = deferred<BuildListOptimizationStartPreparation>()
    let reads = 0
    const { session, runs } = sessionWith(() => (++reads === 1 ? firstRead.promise : Promise.resolve(START)))
    const first = session.start()
    const second = session.start()
    // The first start is superseded while preparing; its read arriving later starts nothing.
    firstRead.resolve(START)
    await flush()
    expect(runs).toHaveLength(1)
    expect(session.getState()).toMatchObject({ status: 'running', runId: 2 })
    // A third start supersedes the running second one: its Worker run is cancelled and its late outcome is ignored.
    const third = session.start()
    expect(runs[0]!.cancel).toHaveBeenCalledTimes(1)
    await flush()
    runs[0]!.settle({ status: 'completed', requestId: 'run-1', result: NOT_FOUND })
    runs[1]!.settle({ status: 'completed', requestId: 'run-2', result: NOT_FOUND })
    const finalState = await third
    expect(finalState).toMatchObject({ status: 'completed', runId: 3 })
    expect(session.getState()).toBe(finalState)
    // The superseded starts resolve with the state that superseded them, never with a state of their own.
    expect(await first).not.toMatchObject({ runId: 1 })
    expect(await second).not.toMatchObject({ runId: 2, status: 'completed' })
  })

  it('discards the previous result back to idle, cancelling a running start first', async () => {
    const { session, runs } = sessionWith(async () => START)
    const finished = session.start()
    await flush()
    runs[0]!.settle({ status: 'completed', requestId: 'run-1', result: NOT_FOUND })
    await finished
    session.discard()
    expect(session.getState()).toEqual({ status: 'idle' })
    void session.start()
    await flush()
    session.discard()
    expect(runs[1]!.cancel).toHaveBeenCalledTimes(1)
    expect(session.getState()).toEqual({ status: 'idle' })
  })

  it('disposes: cancels, releases the Client and ignores every later start', async () => {
    const { session, runs, client } = sessionWith(async () => START)
    void session.start()
    await flush()
    session.dispose()
    expect(runs[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(client.dispose).toHaveBeenCalledTimes(1)
    expect(session.getState()).toEqual({ status: 'disposed' })
    expect(await session.start()).toEqual({ status: 'disposed' })
    expect(client.run).toHaveBeenCalledTimes(1)
  })
})
