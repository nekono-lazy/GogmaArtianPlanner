import { describe, expect, it } from 'vitest'
import { createSearchWorkerController, workerYield } from './search.worker'
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '../domain/search'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../test/fixtures/candidateSearch'
import { targetWeaponId } from '../test/fixtures/domainData'

describe('Candidate Search Worker', () => {
  it('keeps RngEngine outside the structured-clone Worker request', () => {
    const request: SearchWorkerRequest = {
      type: 'candidate_search',
      requestId: 'request.fixture.serializable',
      input: createCandidateSearchInput(),
    }
    expect(request).not.toHaveProperty('rngEngine')
    expect(request.input).not.toHaveProperty('rngEngine')
    expect(structuredClone(request)).toEqual(request)
  })

  it('returns progress and result with the requestId for multiple Targets', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const secondTarget = {
      ...input.targetWeapons[0],
      id: targetWeaponId('target.fixture.second'),
      name: 'Second fixture target',
    }
    input.targetWeapons.push(secondTarget)
    input.targetWeaponIds.push(secondTarget.id)
    const responses: SearchWorkerResponse[] = []
    const controller = createSearchWorkerController(
      createCandidateSearchEngine(input),
      (response) => responses.push(response),
    )

    await controller.handleMessage({
      type: 'candidate_search',
      requestId: 'request.fixture.progress',
      input,
    })

    const progress = responses.filter(
      (response): response is Extract<
        SearchWorkerResponse,
        { type: 'progress' }
      > => response.type === 'progress',
    )
    expect(progress).toHaveLength(2)
    expect(progress.map((item) => item.requestId)).toEqual([
      'request.fixture.progress',
      'request.fixture.progress',
    ])
    expect(progress.map((item) => item.completedTargets)).toEqual([1, 2])
    expect(responses.at(-1)).toEqual(
      expect.objectContaining({
        type: 'candidate_search_result',
        requestId: 'request.fixture.progress',
      }),
    )
  })

  it('does not post a final result after cancellation', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const secondTarget = {
      ...input.targetWeapons[0],
      id: targetWeaponId('target.fixture.cancel.second'),
    }
    input.targetWeapons.push(secondTarget)
    input.targetWeaponIds.push(secondTarget.id)
    const responses: SearchWorkerResponse[] = []
    const controllerHolder: {
      value?: ReturnType<typeof createSearchWorkerController>
    } = {}
    const controller = createSearchWorkerController(
      createCandidateSearchEngine(input),
      (response) => {
        responses.push(response)
        if (response.type === 'progress' && response.completedTargets === 1) {
          void controllerHolder.value?.handleMessage({
            type: 'cancel',
            requestId: 'request.fixture.cancel',
          })
        }
      },
    )
    controllerHolder.value = controller

    await controller.handleMessage({
      type: 'candidate_search',
      requestId: 'request.fixture.cancel',
      input,
    })
    expect(controller.isCancelled('request.fixture.cancel')).toBe(true)
    expect(
      responses.some(({ type }) => type === 'candidate_search_result'),
    ).toBe(false)
  })

  it('yields to a macrotask so a queued Worker message can be dispatched', async () => {
    // A microtask yield would resolve inside the same task and never let the
    // Worker dispatch a pending `cancel` message.
    let resolved = false
    const yielded = workerYield().then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    await yielded
    expect(resolved).toBe(true)
  })

  it('resolves concurrent checkpoint yields in order', async () => {
    const settled: number[] = []
    await Promise.all([
      workerYield().then(() => settled.push(1)),
      workerYield().then(() => settled.push(2)),
      workerYield().then(() => settled.push(3)),
    ])
    expect(settled).toEqual([1, 2, 3])
  })

  it('converts search failures into an error response', async () => {
    const input = createCandidateSearchInput()
    input.settings.maxGogmaAdvance = 0
    const responses: SearchWorkerResponse[] = []
    const controller = createSearchWorkerController(
      createCandidateSearchEngine(input),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'candidate_search',
      requestId: 'request.fixture.error',
      input,
    })
    expect(responses).toEqual([
      expect.objectContaining({
        type: 'error',
        requestId: 'request.fixture.error',
      }),
    ])
  })
})
