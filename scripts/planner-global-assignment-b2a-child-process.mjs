// Issue #154 Phase B-2A (Research only): the child process envelope of the assignment-only runner, kept apart from the
// runner so a synthetic test can drive it with a fake `spawn` (no Export, no real child).
//
// Contract: the returned promise always settles exactly once - on `close` (exit code and signal), on a spawn / process
// `error` (an OS-level start failure such as ENOENT), or when `spawn` itself throws. The wall-clock timer is released on
// every path. A start failure is `failed` and the runner records it as `unmeasured(process_failure)`; a timeout is
// `timed_out` (the child is killed with SIGKILL); an out-of-memory stderr signature is `out_of_memory`; only exit code 0
// with the record written is `completed`. Nothing here retries, and nothing here runs two children at once.

/** Classifies one finished child. `spawnError` wins (the child never ran as asked), then the timeout, then the OOM signature. */
export function classifyChildOutcome({ exitCode, timedOut, stderrTail, recordWritten, spawnError }) {
  if (spawnError) return 'failed'
  if (timedOut) return 'timed_out'
  if (/heap out of memory|Allocation failed|FATAL ERROR/i.test(stderrTail ?? '')) return 'out_of_memory'
  return exitCode === 0 && recordWritten ? 'completed' : 'failed'
}

/** The `unmeasured` reason of a child that did not complete (never `no_resource_assignment`). */
export function unmeasuredReasonOf(outcome) {
  return outcome === 'timed_out' ? 'timeout' : outcome === 'out_of_memory' ? 'out_of_memory' : 'process_failure'
}

/**
 * Runs one child under a wall-clock envelope.
 *
 * - `spawnProcess(execPath, args, options)`: `child_process.spawn` or a test double returning a ChildProcess-like emitter
 * - `recordWritten()`: whether the child's record file exists when it ends
 * - `now` / `setTimer` / `clearTimer`: injectable clocks and timers (defaults: `performance.now`, `setTimeout`, `clearTimeout`)
 * - `onStart(child)`: called once right after a successful spawn (logging)
 */
export function runChildProcess({ spawnProcess, execPath, args, wallMs, recordWritten, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, onStart }) {
  return new Promise(resolve => {
    const began = now()
    let settled = false
    let timedOut = false
    let stderrTail = ''
    let timer = null
    let child = null
    const settle = fields => {
      if (settled) return
      settled = true
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      const written = recordWritten()
      const outcome = classifyChildOutcome({ exitCode: fields.exitCode ?? null, timedOut, stderrTail, recordWritten: written, spawnError: fields.spawnError ?? null })
      resolve({
        outcome, exitCode: fields.exitCode ?? null, signal: fields.signal ?? null, timedOut, spawnError: fields.spawnError ?? null, settledBy: fields.settledBy,
        wallObservedMs: now() - began, pid: child?.pid ?? null, recordWritten: written, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000),
      })
    }
    try {
      child = spawnProcess(execPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    } catch (error) {
      settle({ spawnError: `spawn threw: ${error?.message ?? String(error)}`, settledBy: 'spawn_throw' })
      return
    }
    onStart?.(child)
    child.stderr?.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-8000) })
    child.once('error', error => settle({ spawnError: `child error: ${error?.message ?? String(error)}`, settledBy: 'error' }))
    child.once('close', (code, signal) => settle({ exitCode: code, signal, settledBy: 'close' }))
    timer = setTimer(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch (error) {
        settle({ spawnError: `kill after timeout failed: ${error?.message ?? String(error)}`, settledBy: 'timeout_kill_failed' })
      }
    }, wallMs)
  })
}
