/**
 * Issue #154 Phase 2-C2.6-A: the post-H1 Global Planner kernel re-evaluation, Research only. Never import from Production.
 *
 * The same original Export, the same baseline Conflict orientations and the same Production default extent / trial
 * bounds as Phase 2-C2, re-run kernel-only against the CURRENT Production (after the D2-a Ideal-only publication and the
 * D2-d single-pass held-aware Bonus stream). Every calculation is the unchanged Phase 2-C2 helper:
 *
 * - `runPhase2C2Baseline()`: the ordinary Production Planner over the original Build List; its own Conflicts give the
 *   orientations through `derivePhase2C2Orientations()` (`c<conflict index>-p<participant index>`);
 * - `runPhase2C2Kernel()`: one orientation = the current Planner Alternative kernel, request built by
 *   `phase2c2KernelRequest()` (no lineage) from `phase2c2ProductionDefaultConditions()` (Production spread copies);
 * - `classifyPhase2C2ChildExit()`: how one fresh child process ended.
 *
 * Nothing here runs a post-hoc portfolio Search, a probe, an oracle or a global assignment. The conditions object is the
 * Phase 2-C2 one as it is; its `captureBound` is never read by the kernel (it only sizes the portfolio Search, which this
 * phase does not run). No Target ID, Entry ID, Conflict key, orientation ID or orientation count is fixed here.
 */
import {
  classifyPhase2C2ChildExit,
  phase2c2ProductionDefaultConditions,
  runPhase2C2Baseline,
  runPhase2C2Kernel,
  type Phase2C2ChildOutcome,
  type Phase2C2Conditions,
  type Phase2C2KernelRecord,
  type Phase2C2Orientation,
  type Phase2C2RunDependencies,
} from './plannerGlobalPhase2C2'
import type { PlannerInput } from '../domain/planner/plannerTypes'

/** Node child heap limit of the formal series (Phase 2-C2's). */
export const PHASE2C26A_CHILD_HEAP_MB = 8192
/** Kernel children run at once (Phase 2-C2's). */
export const PHASE2C26A_CONCURRENCY = 3
/** One orientation's (and the baseline's) process budget (Phase 2-C2's `orientationBudgetMs`). */
export const PHASE2C26A_ORIENTATION_BUDGET_MS = 30 * 60 * 1000
/** In-child `process.memoryUsage()` sampling interval (Phase 2-C2's). Sampled maxima are never a true peak. */
export const PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The kernel's `yieldControl` in a Node child (Phase 2-C2's). */
export const PHASE2C26A_NODE_YIELD = 'setImmediate'
/** Every child status this phase distinguishes. A timeout and an OOM are failures, never "no Candidate". */
export const PHASE2C26A_CHILD_STATUSES = ['completed', 'out_of_memory', 'timeout', 'process_failure'] as const satisfies readonly Phase2C2ChildOutcome[]

export interface Phase2C26AKernelTask {
  orientation: Phase2C2Orientation
  conditions: Phase2C2Conditions
}

/** The kernel task of one orientation: the orientation exactly as the baseline derived it, Production default conditions. */
export function phase2c26aKernelTask(orientation: Phase2C2Orientation): Phase2C26AKernelTask {
  return { orientation: structuredClone(orientation), conditions: phase2c2ProductionDefaultConditions() }
}

/** One task per baseline orientation, in the baseline's own order (never filtered, never reordered). */
export function phase2c26aKernelTasks(orientations: readonly Phase2C2Orientation[]): Phase2C26AKernelTask[] {
  return orientations.map(phase2c26aKernelTask)
}

export function phase2c26aKernelChildId(orientationId: string): string {
  return `kernel-${orientationId}`
}

/** The baseline child calculation (unchanged Phase 2-C2 helper). */
export function runPhase2C26ABaseline(input: PlannerInput, dependencies: Phase2C2RunDependencies) {
  return runPhase2C2Baseline(input, dependencies)
}

/** One kernel child calculation (unchanged Phase 2-C2 helper, the task's orientation and conditions as given). */
export function runPhase2C26AKernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies): Promise<Phase2C2KernelRecord> {
  return runPhase2C2Kernel(input, task.orientation, task.conditions, dependencies)
}

/** How one child ended (unchanged Phase 2-C2 rule). */
export const classifyPhase2C26AChildExit = classifyPhase2C2ChildExit

export interface Phase2C26AMemoryMaxima {
  samples: number
  maxHeapUsedBytes: number
  maxRssBytes: number
  lastElapsedMs: number
}

/** Running sampled maxima of one child (`process.memoryUsage()` shape). */
export function createPhase2C26AMemoryTracker(now: () => number = () => performance.now()) {
  const started = now()
  const maxima: Phase2C26AMemoryMaxima = { samples: 0, maxHeapUsedBytes: 0, maxRssBytes: 0, lastElapsedMs: 0 }
  return {
    sample(usage: { heapUsed: number; rss: number }): Phase2C26AMemoryMaxima {
      maxima.samples += 1
      maxima.maxHeapUsedBytes = Math.max(maxima.maxHeapUsedBytes, usage.heapUsed)
      maxima.maxRssBytes = Math.max(maxima.maxRssBytes, usage.rss)
      maxima.lastElapsedMs = now() - started
      return { ...maxima }
    },
    current(): Phase2C26AMemoryMaxima { return { ...maxima } },
  }
}
