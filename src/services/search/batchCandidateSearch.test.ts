import { describe, expect, it, vi } from 'vitest'
import type { BuildCandidate, BuildListEntry, TargetWeapon } from '../../domain/models/publicTypes'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../../domain/buildList'
import type {
  CandidateSearchInput,
  CandidateSearchResult,
  CandidateSearchSettings,
} from '../../domain/search'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createCandidateSearchInput as createFixtureInput } from '../../test/fixtures/candidateSearch'
import {
  candidateId,
  createValidBuildCandidate,
  createValidTargetWeapon,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import type { AddBuildListCandidateResult } from '../buildList/buildListService'
import {
  SearchCancelledError,
  SearchWorkerRuntimeError,
  type SearchWorkerClient,
  type SearchWorkerClientCallbacks,
} from './searchWorkerClient'
import {
  runBatchCandidateSearch,
  selectBatchCandidateSearchTargets,
  type BatchCandidateSearchDependencies,
  type BatchCandidateSearchProgress,
} from './batchCandidateSearch'

/** A client that answers each request by its `searchRunId`, as the real one does. */
class QueueClient implements SearchWorkerClient {
  readonly engineVersion = 'fake-fixture:candidate-search-v1'
  readonly requests: { input: CandidateSearchInput; callbacks: SearchWorkerClientCallbacks }[] = []
  private readonly pending = new Map<string, { resolve: (r: CandidateSearchResult) => void; reject: (e: Error) => void }>()
  readonly cancelSearch = vi.fn((requestId: string) => {
    const current = this.pending.get(requestId)
    this.pending.delete(requestId)
    current?.reject(new SearchCancelledError())
  })
  readonly dispose = vi.fn()
  startSearch(input: CandidateSearchInput, callbacks: SearchWorkerClientCallbacks = {}) {
    this.requests.push({ input, callbacks })
    return new Promise<CandidateSearchResult>((resolve, reject) => {
      this.pending.set(input.searchRunId, { resolve, reject })
    })
  }
  get last() {
    const request = this.requests.at(-1)
    if (!request) throw new Error('no request')
    return request
  }
  resolveLast(candidate: BuildCandidate | null) {
    const { input } = this.last
    this.pending.get(input.searchRunId)?.resolve({
      searchRunId: input.searchRunId,
      calculationContext: input.calculationContext,
      targetResult: { targetWeaponId: input.targetWeaponId, candidate, searchedRoutes: [], skippedRoutes: [] },
      warnings: [],
      elapsedMs: 1,
    })
  }
  rejectLast(error: Error) {
    this.pending.get(this.last.input.searchRunId)?.reject(error)
  }
}

function target(id: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name: `目標 ${id}`, ...overrides }
}

function candidateFor(targetValue: TargetWeapon, suffix = ''): BuildCandidate {
  return { ...createValidBuildCandidate(), id: candidateId(`candidate.${targetValue.id}${suffix}`), targetWeaponId: targetValue.id }
}

const settings: CandidateSearchSettings = { maxNormalAdvance: 3, maxGogmaAdvance: 4, maxSkillAdvance: 5 }

function setup(targets: TargetWeapon[], addResult?: (candidate: BuildCandidate, t: TargetWeapon) => AddBuildListCandidateResult) {
  const client = new QueueClient()
  let runId = 0
  const dependencies: BatchCandidateSearchDependencies = {
    client,
    createSearchRunId: () => `batch-run-${++runId}`,
    createInput: vi.fn(async (options) => ({
      ...createFixtureInput(),
      ...options,
      targetWeapons: targets,
    })),
    saveCandidates: vi.fn(async () => undefined),
    addCandidate: vi.fn(async (candidate: BuildCandidate, t: TargetWeapon, selection) =>
      addResult?.(candidate, t) ?? {
        status: 'added' as const,
        entry: createBuildListEntry(candidate, t, { intermediateStateSelection: selection }),
      }),
  }
  const progress: BatchCandidateSearchProgress[] = []
  const master = createValidMasterDataFixture()
  const run = runBatchCandidateSearch(
    {
      targets,
      routeFilter: 'existing_gogma',
      settings,
      master,
      calculationContext: createFixtureInput().calculationContext,
    },
    dependencies,
    (next) => progress.push(next),
  )
  return { client, dependencies, progress, run }
}

/** Lets pending microtasks (createInput, save, add) settle. */
async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

describe('selectBatchCandidateSearchTargets', () => {
  it('selects only searchable Targets without any Build List Entry', () => {
    const open = target('target.open')
    const disabled = target('target.disabled', { isEnabled: false })
    const completed = target('target.completed', { lifecycleStatus: 'completed' })
    const registered = target('target.registered')
    const stale = target('target.stale')
    const legacy = target('target.legacy')
    const staleEntry: BuildListEntry = {
      ...createBuildListEntry(candidateFor(stale), stale),
      isStale: true,
      staleReasons: ['rng_state_changed'],
    }
    const entries = [
      createBuildListEntry(candidateFor(registered), registered),
      staleEntry,
      createBuildListEntry(candidateFor(legacy), legacy),
      createBuildListEntry(candidateFor(legacy, '.second'), legacy),
    ]
    expect(
      selectBatchCandidateSearchTargets([open, disabled, completed, registered, stale, legacy], entries).map(({ id }) => id),
    ).toEqual([open.id])
  })
})

describe('runBatchCandidateSearch', () => {
  it('runs the single search once per Target with its own searchRunId and the shared conditions', async () => {
    const first = target('target.first')
    const second = target('target.second')
    const { client, dependencies, run, progress } = setup([first, second])
    await flush()
    expect(client.requests).toHaveLength(1)
    expect(client.last.input).toMatchObject({
      searchRunId: 'batch-run-1',
      targetWeaponId: first.id,
      routeFilter: 'existing_gogma',
      settings,
    })
    client.last.callbacks.onProgress?.({ targetWeaponId: first.id, phase: 'searching', processedWorkItems: 300 })
    const firstCandidate = candidateFor(first)
    client.resolveLast(firstCandidate)
    await flush()
    expect(dependencies.saveCandidates).toHaveBeenCalledWith(first.id, [firstCandidate])
    // The found Ideal is registered with no intermediate state and the Planner preference.
    expect(dependencies.addCandidate).toHaveBeenCalledWith(firstCandidate, first, defaultIntermediateStateSelection())
    expect(client.requests).toHaveLength(2)
    expect(client.last.input).toMatchObject({ searchRunId: 'batch-run-2', targetWeaponId: second.id })
    client.resolveLast(candidateFor(second))
    const summary = await run.promise
    expect(summary.termination).toEqual({ status: 'completed' })
    expect(summary.outcomes.map(({ status, target: t }) => [status, t.id])).toEqual([
      ['added', first.id],
      ['added', second.id],
    ])
    expect(summary.notStarted).toEqual([])
    expect(progress[0]).toMatchObject({ index: 0, total: 2, completed: 0, search: { phase: 'preparing' } })
    expect(progress).toContainEqual(expect.objectContaining({
      index: 0,
      search: { targetWeaponId: first.id, phase: 'searching', processedWorkItems: 300 },
    }))
    expect(progress.at(-1)).toMatchObject({ index: 1, completed: 1, target: second })
  })

  it('records a Target without a Candidate or with a failure and moves on', async () => {
    const empty = target('target.empty')
    const broken = target('target.broken')
    const found = target('target.found')
    const { client, dependencies, run } = setup([empty, broken, found])
    await flush()
    client.resolveLast(null)
    await flush()
    expect(dependencies.saveCandidates).toHaveBeenCalledWith(empty.id, [])
    client.rejectLast(new Error('fixture failure'))
    await flush()
    client.resolveLast(candidateFor(found))
    const summary = await run.promise
    expect(summary.outcomes).toEqual([
      { status: 'no_candidate', target: empty },
      { status: 'failed', target: broken, message: 'fixture failure' },
      expect.objectContaining({ status: 'added', target: found }),
    ])
    expect(dependencies.addCandidate).toHaveBeenCalledTimes(1)
  })

  it('never replaces an Entry: every non-added Service result is recorded as it came', async () => {
    const targets = [target('target.dup'), target('target.replace'), target('target.legacy')]
    const results: AddBuildListCandidateResult[] = []
    const { client, run } = setup(targets, (candidate, t) => {
      const entry = createBuildListEntry(candidate, t)
      const result: AddBuildListCandidateResult =
        t.id === 'target.dup'
          ? { status: 'duplicate', entry }
          : t.id === 'target.replace'
            ? { status: 'replacement_required', existingEntry: entry }
            : { status: 'legacy_duplicate', entries: [entry, entry] }
      results.push(result)
      return result
    })
    for (const t of targets) {
      await flush()
      client.resolveLast(candidateFor(t))
    }
    const summary = await run.promise
    expect(summary.outcomes).toEqual([
      { status: 'not_added', target: targets[0], reason: 'duplicate' },
      { status: 'not_added', target: targets[1], reason: 'replacement_required' },
      { status: 'not_added', target: targets[2], reason: 'legacy_duplicate' },
    ])
    expect(results).toHaveLength(3)
  })

  it('cancels the running search, starts no further Target, and keeps earlier additions', async () => {
    const targets = [target('target.a'), target('target.b'), target('target.c')]
    const { client, dependencies, run } = setup(targets)
    await flush()
    client.resolveLast(candidateFor(targets[0]))
    await flush()
    expect(client.requests).toHaveLength(2)
    run.cancel()
    expect(client.cancelSearch).toHaveBeenCalledWith('batch-run-2')
    const summary = await run.promise
    await flush()
    expect(summary.termination).toEqual({ status: 'cancelled' })
    expect(summary.outcomes).toEqual([expect.objectContaining({ status: 'added', target: targets[0] })])
    expect(summary.notStarted).toEqual([targets[1], targets[2]])
    expect(client.requests).toHaveLength(2)
    expect(dependencies.addCandidate).toHaveBeenCalledTimes(1)
    expect(dependencies.saveCandidates).toHaveBeenCalledTimes(1)
  })

  it('stops the batch when the Search Worker itself is broken', async () => {
    const targets = [target('target.a'), target('target.b')]
    const { client, run } = setup(targets)
    await flush()
    client.rejectLast(new SearchWorkerRuntimeError('worker_error', 'boom'))
    const summary = await run.promise
    expect(summary.termination.status).toBe('aborted')
    expect(summary.outcomes).toEqual([expect.objectContaining({ status: 'failed', target: targets[0] })])
    expect(summary.notStarted).toEqual([targets[1]])
    expect(client.requests).toHaveLength(1)
  })
})
