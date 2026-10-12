import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { classifyChildOutcome, OUT_OF_MEMORY_SIGNATURE, runChildProcess } from './planner-global-assignment-d0b-child-process.mjs'

/*
 * Issue #154 Phase D-0B: the child process envelope of the materialization runner settles exactly once, releases its timer and
 * abort listener on every path, and tells completed / timeout / cancelled / out_of_memory / process_failure apart. Out of memory
 * is read only from the V8 heap-limit signature: any other fatal error or unexplained exit is a process failure. Driven by a
 * fake spawn and by tiny real child processes (an endless loop, an exit code, a simulated signature line); no Export, no real
 * out-of-memory.
 */
interface FakeChild extends EventEmitter {
  pid: number | undefined
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = 4242
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function harness(options: { recordWritten?: boolean; spawnThrows?: Error; signal?: AbortSignal } = {}) {
  const child = fakeChild()
  const timers: { callback: () => void; delay: number }[] = []
  const cleared: unknown[] = []
  let tick = 0
  const spawnProcess = vi.fn(() => {
    if (options.spawnThrows) throw options.spawnThrows
    return child
  })
  const promise = runChildProcess({
    spawnProcess, execPath: 'node', args: ['script.mjs', '--role', 'materialize'], wallMs: 1_000, signal: options.signal,
    recordWritten: () => options.recordWritten ?? false,
    now: () => (tick += 1),
    setTimer: ((callback: () => void, delay: number) => { timers.push({ callback, delay }); return { handle: timers.length } }) as unknown as typeof setTimeout,
    clearTimer: ((handle: unknown) => { cleared.push(handle) }) as unknown as typeof clearTimeout,
  })
  return { child, timers, cleared, spawnProcess, promise }
}

const V8_OOM = '\n<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n'

describe('classifyChildOutcome', () => {
  it('orders a start failure, the cancellation, the timeout and the V8 heap-limit signature before the exit code', () => {
    const base = { exitCode: 0, timedOut: false, cancelled: false, stderrTail: '', recordWritten: true, spawnError: null }
    expect(classifyChildOutcome(base)).toBe('completed')
    expect(classifyChildOutcome({ ...base, recordWritten: false })).toBe('process_failure')
    expect(classifyChildOutcome({ ...base, exitCode: 1, recordWritten: false, stderrTail: 'Error: boom' })).toBe('process_failure')
    expect(classifyChildOutcome({ ...base, exitCode: 134, recordWritten: false, stderrTail: V8_OOM })).toBe('out_of_memory')
    expect(classifyChildOutcome({ ...base, exitCode: 134, recordWritten: false, stderrTail: 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed' })).toBe('out_of_memory')
    // Another fatal error, or an unexplained signal / exit code, is never guessed to be out of memory.
    expect(classifyChildOutcome({ ...base, exitCode: 134, recordWritten: false, stderrTail: 'FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal' })).toBe('process_failure')
    expect(classifyChildOutcome({ ...base, exitCode: null, recordWritten: false, stderrTail: '' })).toBe('process_failure')
    expect(classifyChildOutcome({ ...base, exitCode: null, timedOut: true, recordWritten: false, stderrTail: V8_OOM })).toBe('timeout')
    expect(classifyChildOutcome({ ...base, exitCode: null, cancelled: true, timedOut: true, recordWritten: false })).toBe('cancelled')
    expect(classifyChildOutcome({ ...base, spawnError: 'spawn ENOENT', cancelled: true })).toBe('process_failure')
    expect(OUT_OF_MEMORY_SIGNATURE.test('FATAL ERROR: something else')).toBe(false)
  })
})

describe('runChildProcess (fake spawn)', () => {
  it('completes on close with exit code 0 and a written record, releasing the timer', async () => {
    const { child, timers, cleared, promise, spawnProcess } = harness({ recordWritten: true })
    expect(spawnProcess).toHaveBeenCalledWith('node', ['script.mjs', '--role', 'materialize'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    expect(timers[0]!.delay).toBe(1_000)
    child.emit('close', 0, null)
    expect(await promise).toMatchObject({ outcome: 'completed', exitCode: 0, timedOut: false, cancelled: false, settledBy: 'close', pid: 4242, recordWritten: true, stderrTail: null })
    expect(cleared).toHaveLength(1)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills on the wall-clock and reports timeout even when an OOM signature follows', async () => {
    const { child, timers, cleared, promise } = harness()
    timers[0]!.callback()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.stderr.emit('data', V8_OOM)
    child.emit('close', null, 'SIGKILL')
    expect(await promise).toMatchObject({ outcome: 'timeout', timedOut: true, signal: 'SIGKILL', exitCode: null })
    expect(cleared).toHaveLength(1)
  })

  it('reports the V8 signature as out_of_memory and an unexplained exit as process_failure with its stderr tail', async () => {
    const oom = harness()
    oom.child.stderr.emit('data', V8_OOM)
    oom.child.emit('close', 134, null)
    expect((await oom.promise).outcome).toBe('out_of_memory')
    const failed = harness()
    failed.child.stderr.emit('data', 'Error: the Export failed validation\n')
    failed.child.emit('close', 1, null)
    expect(await failed.promise).toMatchObject({ outcome: 'process_failure', exitCode: 1, stderrTail: 'Error: the Export failed validation\n' })
  })

  it('kills the child and settles as cancelled when the signal aborts, and never spawns after an earlier abort', async () => {
    const controller = new AbortController()
    const { child, cleared, promise } = harness({ signal: controller.signal })
    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null, 'SIGKILL')
    expect(await promise).toMatchObject({ outcome: 'cancelled', cancelled: true, timedOut: false })
    expect(cleared).toHaveLength(1)
    const aborted = new AbortController()
    aborted.abort()
    const early = harness({ signal: aborted.signal })
    expect(early.spawnProcess).not.toHaveBeenCalled()
    expect(await early.promise).toMatchObject({ outcome: 'cancelled', settledBy: 'cancelled_before_start', pid: null })
    expect(early.timers).toHaveLength(0)
  })

  it('settles once on a spawn error or a throwing spawn, as a process failure', async () => {
    const errored = harness()
    errored.child.emit('error', new Error('spawn node ENOENT'))
    errored.child.emit('close', -2, null)
    const result = await errored.promise
    expect(result).toMatchObject({ outcome: 'process_failure', spawnError: 'child error: spawn node ENOENT', settledBy: 'error' })
    expect(await errored.promise).toBe(result)
    const thrown = harness({ spawnThrows: new Error('EACCES') })
    expect(await thrown.promise).toMatchObject({ outcome: 'process_failure', spawnError: 'spawn threw: EACCES', settledBy: 'spawn_throw' })
    expect(thrown.timers).toHaveLength(0)
  })
})

describe('runChildProcess (tiny real child processes)', () => {
  const real = (script: string, wallMs: number, signal?: AbortSignal) => runChildProcess({ spawnProcess: spawn, execPath: process.execPath, args: ['-e', script], wallMs, recordWritten: () => false, signal })

  it('kills an endless child at the wall-clock (timeout)', async () => {
    const result = await real('setInterval(() => {}, 1000)', 500)
    expect(result).toMatchObject({ outcome: 'timeout', timedOut: true })
    expect(result.wallObservedMs).toBeGreaterThanOrEqual(400)
  }, 30_000)

  it('reports an abnormal exit as process_failure and a simulated V8 signature as out_of_memory (no real out-of-memory)', async () => {
    expect(await real('process.exit(3)', 20_000)).toMatchObject({ outcome: 'process_failure', exitCode: 3 })
    expect(await real('console.error("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"); process.exit(134)', 20_000)).toMatchObject({ outcome: 'out_of_memory', exitCode: 134 })
    // Exit 0 without the record is still a failure of the run.
    expect(await real('process.exit(0)', 20_000)).toMatchObject({ outcome: 'process_failure', exitCode: 0, recordWritten: false })
  }, 60_000)

  it('cancels a running child through the abort signal', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    expect(await real('setInterval(() => {}, 1000)', 20_000, controller.signal)).toMatchObject({ outcome: 'cancelled', cancelled: true, timedOut: false })
  }, 30_000)
})
