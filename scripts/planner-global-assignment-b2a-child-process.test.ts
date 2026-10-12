import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { classifyChildOutcome, runChildProcess, unmeasuredReasonOf } from './planner-global-assignment-b2a-child-process.mjs'

/*
 * Issue #154 Phase B-2A: the child process envelope settles exactly once on close / error / spawn throw, releases its
 * timer on every path, classifies completed / timed_out / out_of_memory / failed, and turns a start failure into a
 * recordable `failed` (unmeasured process_failure) instead of an unhandled error. Driven by a fake spawn: no Export,
 * no real child.
 */
interface FakeChild extends EventEmitter {
  pid: number | undefined
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(pid: number | undefined = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function harness(options: { recordWritten?: boolean; spawnThrows?: Error } = {}) {
  const child = fakeChild()
  const timers: { callback: () => void; delay: number }[] = []
  const cleared: unknown[] = []
  let tick = 0
  const spawnProcess = vi.fn(() => {
    if (options.spawnThrows) throw options.spawnThrows
    return child
  })
  const promise = runChildProcess({
    spawnProcess, execPath: 'node', args: ['script.mjs', '--role', 'assignment'], wallMs: 1_000,
    recordWritten: () => options.recordWritten ?? false,
    now: () => (tick += 1),
    setTimer: ((callback: () => void, delay: number) => { timers.push({ callback, delay }); return { handle: timers.length } }) as unknown as typeof setTimeout,
    clearTimer: ((handle: unknown) => { cleared.push(handle) }) as unknown as typeof clearTimeout,
  })
  return { child, timers, cleared, spawnProcess, promise }
}

describe('classifyChildOutcome / unmeasuredReasonOf', () => {
  it('orders spawn error, timeout, out-of-memory signature, then exit code with record', () => {
    expect(classifyChildOutcome({ exitCode: 0, timedOut: false, stderrTail: '', recordWritten: true, spawnError: null })).toBe('completed')
    expect(classifyChildOutcome({ exitCode: 0, timedOut: false, stderrTail: '', recordWritten: false, spawnError: null })).toBe('failed')
    expect(classifyChildOutcome({ exitCode: 1, timedOut: false, stderrTail: 'Error: boom', recordWritten: false, spawnError: null })).toBe('failed')
    expect(classifyChildOutcome({ exitCode: 134, timedOut: false, stderrTail: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', recordWritten: false, spawnError: null })).toBe('out_of_memory')
    expect(classifyChildOutcome({ exitCode: null, timedOut: true, stderrTail: 'heap out of memory', recordWritten: false, spawnError: null })).toBe('timed_out')
    expect(classifyChildOutcome({ exitCode: 0, timedOut: false, stderrTail: '', recordWritten: true, spawnError: 'spawn ENOENT' })).toBe('failed')
    expect(unmeasuredReasonOf('timed_out')).toBe('timeout')
    expect(unmeasuredReasonOf('out_of_memory')).toBe('out_of_memory')
    expect(unmeasuredReasonOf('failed')).toBe('process_failure')
  })
})

describe('runChildProcess', () => {
  it('completes on close with exit code 0 and a written record, releasing the timer', async () => {
    const { child, timers, cleared, promise, spawnProcess } = harness({ recordWritten: true })
    expect(spawnProcess).toHaveBeenCalledWith('node', ['script.mjs', '--role', 'assignment'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    expect(timers).toHaveLength(1)
    expect(timers[0]!.delay).toBe(1_000)
    child.stderr.emit('data', Buffer.from('warning only'))
    child.emit('close', 0, null)
    const result = await promise
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, signal: null, timedOut: false, spawnError: null, settledBy: 'close', pid: 4242, recordWritten: true, stderrTail: null })
    expect(result.wallObservedMs).toBeGreaterThan(0)
    expect(cleared).toHaveLength(1)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reports a non-zero exit as failed with the stderr tail', async () => {
    const { child, promise } = harness({ recordWritten: false })
    child.stderr.emit('data', 'Error: the task is invalid\n')
    child.emit('close', 1, null)
    expect(await promise).toMatchObject({ outcome: 'failed', exitCode: 1, stderrTail: 'Error: the task is invalid\n', settledBy: 'close' })
  })

  it('kills the child when the wall-clock fires and reports timed_out even if stderr shows an OOM signature later', async () => {
    const { child, timers, cleared, promise } = harness()
    timers[0]!.callback()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.stderr.emit('data', 'heap out of memory')
    child.emit('close', null, 'SIGKILL')
    const result = await promise
    expect(result).toMatchObject({ outcome: 'timed_out', timedOut: true, signal: 'SIGKILL', exitCode: null, settledBy: 'close' })
    expect(unmeasuredReasonOf(result.outcome)).toBe('timeout')
    expect(cleared).toHaveLength(1)
  })

  it('reports the V8 out-of-memory signature as out_of_memory', async () => {
    const { child, promise } = harness()
    child.stderr.emit('data', '\n<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n')
    child.emit('close', 134, null)
    const result = await promise
    expect(result.outcome).toBe('out_of_memory')
    expect(unmeasuredReasonOf(result.outcome)).toBe('out_of_memory')
  })

  it('settles once on a spawn error and ignores a later close (no double settle), releasing the timer', async () => {
    const { child, cleared, promise } = harness({ recordWritten: false })
    child.pid = undefined
    child.emit('error', Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }))
    child.emit('close', -2, null)
    const result = await promise
    expect(result).toMatchObject({ outcome: 'failed', spawnError: 'child error: spawn node ENOENT', settledBy: 'error', exitCode: null, pid: null })
    expect(unmeasuredReasonOf(result.outcome)).toBe('process_failure')
    expect(cleared).toHaveLength(1)
    // A second settle attempt changes nothing: the promise already resolved with the error outcome.
    expect(await promise).toBe(result)
  })

  it('settles once on close and ignores a later error', async () => {
    const { child, cleared, promise } = harness({ recordWritten: true })
    child.emit('close', 0, null)
    child.emit('error', new Error('late error'))
    expect(await promise).toMatchObject({ outcome: 'completed', settledBy: 'close', spawnError: null })
    expect(cleared).toHaveLength(1)
  })

  it('settles as failed when spawn itself throws, without arming a timer', async () => {
    const { timers, cleared, promise, spawnProcess } = harness({ spawnThrows: new Error('EACCES') })
    const result = await promise
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'failed', spawnError: 'spawn threw: EACCES', settledBy: 'spawn_throw', pid: null })
    expect(timers).toHaveLength(0)
    expect(cleared).toHaveLength(0)
  })

  it('settles as failed when the kill after a timeout throws', async () => {
    const { child, timers, promise } = harness()
    child.kill.mockImplementation(() => { throw new Error('ESRCH') })
    timers[0]!.callback()
    const result = await promise
    expect(result).toMatchObject({ outcome: 'failed', spawnError: 'kill after timeout failed: ESRCH', settledBy: 'timeout_kill_failed', timedOut: true })
  })
})
