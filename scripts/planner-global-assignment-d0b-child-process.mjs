// Issue #154 Phase D-0B (Research only): the child process envelope of the materialization runner, kept apart from the
// runner so a test can drive it with a fake `spawn` or a tiny real child (no Export, no Research module). The Phase B-2A
// envelope (`planner-global-assignment-b2a-child-process.mjs`) is not changed or reused: this one adds an explicit
// cancellation and reads out of memory only from the V8 heap-limit signature, never from any other fatal error.
//
// Contract: the returned promise always settles exactly once - on `close` (exit code and signal), on a spawn / process
// `error` (an OS-level start failure such as ENOENT), when `spawn` itself throws, or when the cancellation signal was
// already aborted before the start. The wall-clock timer and the abort listener are released on every path. Outcomes:
// `completed` (exit code 0 and the record written), `timeout` (the wall-clock fired; the child is killed with SIGKILL),
// `cancelled` (the parent's signal aborted; the child is killed), `out_of_memory` (the V8 heap-limit signature on stderr),
// `process_failure` (anything else: a start failure, a non-zero exit, a signal, exit 0 without a record). Nothing here
// retries, and nothing here runs two children at once.

/** The V8 heap-limit messages (`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, `Ineffective mark-compacts near heap limit`). */
export const OUT_OF_MEMORY_SIGNATURE = /JavaScript heap out of memory|Reached heap limit|Ineffective mark-compacts near heap limit/i

/** Classifies one finished child. A start failure wins, then the parent's cancellation, the timeout and the OOM signature. */
export function classifyChildOutcome({ exitCode, timedOut, cancelled, stderrTail, recordWritten, spawnError }) {
  if (spawnError) return 'process_failure'
  if (cancelled) return 'cancelled'
  if (timedOut) return 'timeout'
  if (OUT_OF_MEMORY_SIGNATURE.test(stderrTail ?? '')) return 'out_of_memory'
  return exitCode === 0 && recordWritten ? 'completed' : 'process_failure'
}

/**
 * Runs one child under a wall-clock envelope.
 *
 * - `spawnProcess(execPath, args, options)`: `child_process.spawn` or a test double returning a ChildProcess-like emitter
 * - `recordWritten()`: whether the child's record file exists when it ends
 * - `signal`: an optional AbortSignal; aborting it kills the child and settles as `cancelled`
 * - `now` / `setTimer` / `clearTimer`: injectable clocks and timers (defaults: `performance.now`, `setTimeout`, `clearTimeout`)
 * - `onStart(child)`: called once right after a successful spawn (logging)
 */
export function runChildProcess({ spawnProcess, execPath, args, wallMs, recordWritten, signal, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, onStart }) {
  return new Promise(resolve => {
    const began = now()
    let settled = false
    let timedOut = false
    let cancelled = false
    let stderrTail = ''
    let timer = null
    let child = null
    const onAbort = () => {
      cancelled = true
      try {
        child?.kill('SIGKILL')
      } catch (error) {
        settle({ spawnError: `kill after cancellation failed: ${error?.message ?? String(error)}`, settledBy: 'cancel_kill_failed' })
      }
    }
    const settle = fields => {
      if (settled) return
      settled = true
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      signal?.removeEventListener?.('abort', onAbort)
      const written = recordWritten()
      const outcome = classifyChildOutcome({ exitCode: fields.exitCode ?? null, timedOut, cancelled, stderrTail, recordWritten: written, spawnError: fields.spawnError ?? null })
      resolve({
        outcome, exitCode: fields.exitCode ?? null, signal: fields.signal ?? null, timedOut, cancelled, spawnError: fields.spawnError ?? null, settledBy: fields.settledBy,
        wallObservedMs: now() - began, pid: child?.pid ?? null, recordWritten: written, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000),
      })
    }
    if (signal?.aborted) {
      cancelled = true
      settle({ settledBy: 'cancelled_before_start' })
      return
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
    child.once('close', (code, closeSignal) => settle({ exitCode: code, signal: closeSignal, settledBy: 'close' }))
    signal?.addEventListener?.('abort', onAbort, { once: true })
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
