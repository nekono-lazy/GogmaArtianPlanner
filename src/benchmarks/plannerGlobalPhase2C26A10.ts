/**
 * Issue #154 Phase 2-C2.6-A10: the formal whole-orientation-set kernel availability re-evaluation of the CURRENT Production
 * (after A6 and A9), Research only. Never import from Production.
 *
 * Phase 2-C2.6-A (formal, `timeout_without_out_of_memory`) ran every baseline orientation of the original Export once
 * through the Planner Alternative kernel under the Phase 2-C2 Node conditions (fresh child, heap 8 GB, concurrency 3,
 * 30-minute budget, `setImmediate` yield). A10 re-runs exactly that series against the current Production: every
 * orientation, once, with the unchanged Phase 2-C2.6-A child calculation (`runPhase2C26AKernel()`, no lineage, Production
 * default extent / trial bounds as spread copies), no CPU profiler, no section / depth observer and no heartbeat.
 *
 * Authorities. The committed Phase 2-C2.6-A RESULT is the parity / before authority (read through the unchanged
 * `parsePhase2C26AAuthority()`); the current baseline must equal it (summary, ordered orientation IDs, identity,
 * metadata) and every run condition must equal its conditions, or no kernel runs. The committed Phase 2-C2.6-A9 RESULT is
 * checked as the authority chain (formal, Case O, made against exactly the C2.6-A .. A8 RESULT files read); it selects
 * nothing. The before / after comparison is "C2.6-A measured Production -> current Production" as a whole: A6, A9 and
 * every other change in between are in it, so nothing here attributes a difference to A9 alone.
 *
 * No orientation ID, Target ID, Entry ID, Conflict key or count is fixed here: the task set is the current baseline's own
 * orientations, which must be exactly the authority's.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import {
  phase2c26aKernelTasks,
  runPhase2C26ABaseline,
  runPhase2C26AKernel,
  PHASE2C26A_CHILD_HEAP_MB,
  PHASE2C26A_CONCURRENCY,
  PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A_NODE_YIELD,
  PHASE2C26A_ORIENTATION_BUDGET_MS,
  type Phase2C26AKernelTask,
} from './plannerGlobalPhase2C26A'
import type { Phase2C26A2Authority } from './plannerGlobalPhase2C26A2'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- conditions (Phase 2-C2.6-A's, unchanged)

/** Every run condition is Phase 2-C2.6-A's (its whole-orientation-set formal series). None is lengthened, shortened or relaxed. */
export const PHASE2C26A10_CHILD_HEAP_MB = PHASE2C26A_CHILD_HEAP_MB
export const PHASE2C26A10_CONCURRENCY = PHASE2C26A_CONCURRENCY
export const PHASE2C26A10_ORIENTATION_BUDGET_MS = PHASE2C26A_ORIENTATION_BUDGET_MS
export const PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A10_NODE_YIELD = PHASE2C26A_NODE_YIELD
/** Heap only, exactly as Phase 2-C2.6-A (no profiler / no-inlining / trace flag). */
export const PHASE2C26A10_NODE_FLAGS: readonly string[] = [`--max-old-space-size=${PHASE2C26A_CHILD_HEAP_MB}`]
/** What this phase deliberately does not attach (Phase 2-C2.6-A attached none of them either). */
export const PHASE2C26A10_NOT_ATTACHED = ['cpu_profiler', 'no_inlining_diagnostic', 'search_section_observer', 'reserved_depth_observer', 'kernel_lifecycle_observer', 'heartbeat', 'counting_rng_engine'] as const
/** Each orientation exactly once. */
export const PHASE2C26A10_RETRY = 'none' as const

// ---------------------------------------------------------------- the Phase 2-C2.6-A9 RESULT (authority chain only)

/** The A9 result this phase is registered against. A9 selects nothing here; its primaries are a reference only. */
export const PHASE2C26A10_REGISTERED_A9 = { decisionCase: 'O_optimization_adopted' } as const

/** The earlier RESULT files A9 recorded, by their A9 `sources` key and provenance prefix. */
export const PHASE2C26A10_A9_CHAIN_KEYS = [
  { source: 'c26a2Result', provenance: 'c26a2' }, { source: 'c26a3Result', provenance: 'c26a3' }, { source: 'c26a4Result', provenance: 'c26a4' },
  { source: 'c26a5Result', provenance: 'c26a5' }, { source: 'c26a6Result', provenance: 'c26a6' }, { source: 'c26a7Result', provenance: 'c26a7' },
  { source: 'c26a8Result', provenance: 'c26a8' },
] as const

export interface Phase2C26A10A9Primary {
  orientationId: string
  /** A9's own child outcome (concurrency 1, CPU profiler attached): a reference, never an A10 before value. */
  childOutcome: string
  childWallMs: number | null
}

export interface Phase2C26A10A9Authority {
  measuredHead: string
  analysisHead: string
  decisionCase: string
  concurrency: number | null
  cpuProfiler: boolean | null
  primaries: Phase2C26A10A9Primary[]
  /** The file names of the chain A9 recorded (relative to the A9 RESULT), keyed like `PHASE2C26A10_A9_CHAIN_KEYS[].source`. */
  chainFiles: Record<string, string>
}

export interface Phase2C26A10A9AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A10A9Authority | null
}

/** The file names A9 recorded for its chain, read before the files themselves (so a caller can hash exactly those). */
export function phase2c26a10A9ChainFiles(json: unknown): Record<string, string> | null {
  const sources = isObject(json) && isObject(json.sources) ? json.sources : null
  if (!sources) return null
  const files: Record<string, string> = {}
  for (const { source } of PHASE2C26A10_A9_CHAIN_KEYS) {
    const file = isObject(sources[source]) ? (sources[source] as Json).file : null
    if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+\.json$/.test(file)) return null
    files[source] = file
  }
  return files
}

/**
 * Reads the committed Phase 2-C2.6-A9 RESULT as untrusted JSON and fails closed unless it is the registered formal A9
 * result (formal, no calculation change after its measured HEAD, a valid formal series, Case O) made against exactly the
 * C2.6-A RESULT and the A2 .. A8 RESULT files read (`actual`: their SHA-256), on the C2.6-A Export.
 */
export function parsePhase2C26A9ResultAuthority(json: unknown, actual: { c26a: string; chain: Record<string, string> },
  c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A10A9AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A10A9AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A9 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const sources = isObject(json.sources) ? json.sources : null
  if (!provenance || !summary || !conditions || !sources) return fail('A9 RESULT lacks provenance / summary / conditions / sources')
  if (provenance.formal !== true) issues.push('A9 provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) {
    issues.push('A9 provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  }
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('A9 formalSeriesValidation.valid is not true')
  const decision = isObject(summary.decision) ? summary.decision : {}
  const conclusion = isObject(json.conclusion) && isObject(json.conclusion.decision) ? json.conclusion.decision : {}
  if (decision.case !== PHASE2C26A10_REGISTERED_A9.decisionCase) issues.push(`A9 summary.decision.case ${String(decision.case)} is not ${PHASE2C26A10_REGISTERED_A9.decisionCase}`)
  if (conclusion.case !== PHASE2C26A10_REGISTERED_A9.decisionCase) issues.push('A9 conclusion.decision.case differs from the registered case')
  for (const field of ['measuredHead', 'analysisHead'] as const) {
    if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{40}$/.test(provenance[field] as string)) issues.push(`A9 provenance.${field} is not a commit SHA`)
  }
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A9 provenance.exportSha256 is not the C2.6-A Export')
  if (conditions.exportSha256 !== c26a.conditions.exportSha256) issues.push('A9 conditions.exportSha256 is not the C2.6-A Export')
  // The SHA chain: A9 was made against exactly the C2.6-A and A2 .. A8 RESULT files read.
  const checks: [unknown, string, string][] = [
    [provenance.c26aResultSha256, actual.c26a, 'provenance.c26aResultSha256'], [provenance.c26aResultRecordedByRunner, actual.c26a, 'provenance.c26aResultRecordedByRunner'],
    [isObject(sources.c26aResult) ? sources.c26aResult.sha256 : null, actual.c26a, 'sources.c26aResult.sha256'],
  ]
  for (const { source, provenance: prefix } of PHASE2C26A10_A9_CHAIN_KEYS) {
    const sha = actual.chain[source]
    if (typeof sha !== 'string') { issues.push(`no SHA-256 of the ${source} file read`); continue }
    checks.push([provenance[`${prefix}ResultSha256`], sha, `provenance.${prefix}ResultSha256`], [provenance[`${prefix}ResultRecordedByRunner`], sha, `provenance.${prefix}ResultRecordedByRunner`],
      [isObject(sources[source]) ? (sources[source] as Json).sha256 : null, sha, `sources.${source}.sha256`])
  }
  for (const [recorded, sha, field] of checks) if (recorded !== sha) issues.push(`A9 ${field} is not the SHA-256 of the file read`)
  const chain = isObject(provenance.authorityShaChain) ? provenance.authorityShaChain : {}
  if (chain.allMatchFilesRead !== true) issues.push('A9 provenance.authorityShaChain.allMatchFilesRead is not true')
  const chainFiles = phase2c26a10A9ChainFiles(json)
  if (chainFiles === null) issues.push('A9 sources do not name every chain file')
  const primaries: Phase2C26A10A9Primary[] = []
  for (const row of asArray(summary.byPrimary)) {
    if (!isObject(row) || typeof row.orientationId !== 'string' || typeof row.childOutcome !== 'string') { issues.push('an A9 summary.byPrimary row is malformed'); continue }
    const detail = asArray(json.perPrimary).find(p => isObject(p) && p.orientationId === row.orientationId) as Json | undefined
    primaries.push({ orientationId: row.orientationId, childOutcome: row.childOutcome, childWallMs: typeof detail?.childWallMs === 'number' ? detail.childWallMs : null })
  }
  if (primaries.length === 0) issues.push('A9 summary.byPrimary is empty')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), decisionCase: String(decision.case),
    concurrency: typeof conditions.concurrency === 'number' ? conditions.concurrency : null, cpuProfiler: typeof conditions.cpuProfiler === 'boolean' ? conditions.cpuProfiler : null,
    primaries, chainFiles: chainFiles as Record<string, string> } }
}

// ---------------------------------------------------------------- the full task set

/** One task per current baseline orientation, in the baseline's own order (the unchanged C2.6-A rule; never filtered). */
export function phase2c26a10KernelTasks(orientations: readonly Phase2C2Orientation[]): Phase2C26AKernelTask[] {
  return phase2c26aKernelTasks(orientations)
}

export interface Phase2C26A10TaskSetValidation {
  valid: boolean
  expected: number
  actual: number
  orderedIdsMatch: boolean
  missing: string[]
  duplicate: string[]
  foreign: string[]
  metadataMismatches: { orientationId: string; fields: string[] }[]
}

/**
 * The formal task list must be exactly the authority's whole orientation list: the same IDs in the same order, no
 * missing (a subset), duplicate or foreign orientation, each task orientation field-for-field the one recorded.
 */
export function validatePhase2C26A10TaskSet(tasks: readonly Phase2C26AKernelTask[], authority: Pick<Phase2C26A2Authority, 'orientations'>): Phase2C26A10TaskSetValidation {
  const ids = tasks.map(task => task.orientation.orientationId)
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const id of ids) (seen.has(id) ? duplicate : seen).add(id)
  const recordedById = new Map(authority.orientations.map(o => [o.orientationId, o]))
  const foreign = [...seen].filter(id => !recordedById.has(id))
  const missing = authority.orientations.map(o => o.orientationId).filter(id => !seen.has(id))
  const metadataMismatches: Phase2C26A10TaskSetValidation['metadataMismatches'] = []
  for (const task of tasks) {
    const recorded = recordedById.get(task.orientation.orientationId)
    if (!recorded) continue
    const fields = Object.keys({ ...recorded, ...task.orientation }).filter(field =>
      !same((task.orientation as unknown as Json)[field], (recorded as unknown as Json)[field]))
    if (fields.length > 0) metadataMismatches.push({ orientationId: task.orientation.orientationId, fields })
  }
  const orderedIdsMatch = same(ids, authority.orientations.map(o => o.orientationId))
  const valid = orderedIdsMatch && missing.length === 0 && duplicate.size === 0 && foreign.length === 0 && metadataMismatches.length === 0
  return { valid, expected: authority.orientations.length, actual: ids.length, orderedIdsMatch, missing, duplicate: [...duplicate], foreign, metadataMismatches }
}

// ---------------------------------------------------------------- child calculations (unchanged C2.6-A)

/** The baseline child calculation (the unchanged C2.6-A helper). */
export function runPhase2C26A10Baseline(input: PlannerInput, dependencies: Phase2C2RunDependencies) {
  return runPhase2C26ABaseline(input, dependencies)
}

/** One kernel child calculation: the unchanged C2.6-A kernel, no instrumentation of any kind. */
export function runPhase2C26A10Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies): Promise<Phase2C2KernelRecord> {
  return runPhase2C26AKernel(input, task, dependencies)
}
