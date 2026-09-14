import { vi, type Mock } from 'vitest'
import type {
  NormalArtianCounterIdentificationInput,
  NormalArtianCounterIdentificationProgress,
  NormalArtianCounterIdentificationResult,
} from '../../domain/rng/identification'
import {
  NormalArtianCounterIdentificationCancelledError,
  type NormalArtianCounterIdentificationWorkerClient,
  type NormalArtianCounterIdentificationWorkerClientCallbacks,
} from '../../services/rngIdentification/normalArtianCounterIdentificationWorkerClient'

export interface FakeIdentificationCall {
  readonly requestId: string
  readonly input: NormalArtianCounterIdentificationInput
  readonly callbacks: NormalArtianCounterIdentificationWorkerClientCallbacks
  readonly resolve: (result: NormalArtianCounterIdentificationResult) => void
  readonly reject: (error: Error) => void
}

/**
 * A manually driven Worker Client double. Every `identify()` stays pending
 * until the test resolves or rejects it, so progress, cancellation, late
 * responses and every error class can be exercised without a real Worker.
 * `cancel()` mirrors the Production Client: the pending promise rejects with
 * the cancelled error immediately.
 */
export interface FakeNormalArtianCounterIdentificationClient extends NormalArtianCounterIdentificationWorkerClient {
  readonly identify: Mock<NormalArtianCounterIdentificationWorkerClient['identify']>
  readonly cancel: Mock<NormalArtianCounterIdentificationWorkerClient['cancel']>
  readonly dispose: Mock<NormalArtianCounterIdentificationWorkerClient['dispose']>
  readonly calls: readonly FakeIdentificationCall[]
  lastCall(): FakeIdentificationCall
  emitProgress(progress: NormalArtianCounterIdentificationProgress): void
  resolveLast(result: NormalArtianCounterIdentificationResult): Promise<void>
  rejectLast(error: Error): Promise<void>
}

export function createFakeNormalArtianCounterIdentificationClient(): FakeNormalArtianCounterIdentificationClient {
  const calls: FakeIdentificationCall[] = []
  const pending = new Map<string, FakeIdentificationCall>()
  const lastCall = (): FakeIdentificationCall => {
    const call = calls[calls.length - 1]
    if (call === undefined) throw new Error('identify() has not been called yet.')
    return call
  }
  const settle = async (action: (call: FakeIdentificationCall) => void) => {
    const call = lastCall()
    pending.delete(call.requestId)
    action(call)
    // Let the awaiting UI apply the settled promise.
    await Promise.resolve()
  }
  const identify = vi.fn<NormalArtianCounterIdentificationWorkerClient['identify']>(
    (requestId, input, callbacks = {}) => new Promise<NormalArtianCounterIdentificationResult>((resolve, reject) => {
      const call: FakeIdentificationCall = { requestId, input, callbacks, resolve, reject }
      calls.push(call)
      pending.set(requestId, call)
    }),
  )
  const cancel = vi.fn<NormalArtianCounterIdentificationWorkerClient['cancel']>((requestId) => {
    const call = pending.get(requestId)
    if (!call) return
    pending.delete(requestId)
    call.reject(new NormalArtianCounterIdentificationCancelledError())
  })
  const dispose = vi.fn<NormalArtianCounterIdentificationWorkerClient['dispose']>(() => {
    pending.forEach((call) => call.reject(new NormalArtianCounterIdentificationCancelledError()))
    pending.clear()
  })
  return {
    engineVersion: 'fake-normal-counter-identification',
    identify,
    cancel,
    dispose,
    calls,
    lastCall,
    emitProgress: (progress) => lastCall().callbacks.onProgress?.(progress),
    resolveLast: (result) => settle((call) => call.resolve(result)),
    rejectLast: (error) => settle((call) => call.reject(error)),
  }
}
