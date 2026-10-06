/**
 * Issue #154 Phase 2-C2.6-B2-C2B2I: the first Production optimization of the held-aware `state_generation` hotspot B2-C2B2H
 * attributed (`keep_prediction`: the `predictKeep()` memo key and lookup), and its formal before / after check. Research only.
 * Never import from Production.
 *
 * Exactly one Production calculation source changes, and only its Keep memo representation:
 *
 * ```text
 * src/domain/search/bonusStream.ts  predictKeep()
 *   old  Map<string, RestorationBonusSet>, key `${gogmaCounter}\u0000${familyLayoutKey}` built per lookup
 *   new  Map<number, Map<string, RestorationBonusSet>>, gogmaCounter -> familyLayoutKey -> prediction
 * ```
 *
 * The pair the memo identifies is unchanged, so every prediction input, the tier sharing of one family layout, the lazy
 * prediction, the memo scope (one `createTargetBonusStream()` instance) and every Search result are unchanged. The frontier
 * reduction key, `keepFamilyLayoutKey()`, `reservedGeneratedState()`, the Reset memo, the checkpoint / yield frequency, the
 * Search algorithm, extent, context, P1, the Planner, RNG and UI are untouched.
 *
 * Compared with B2-C2B2H (the formal before evidence) everything else is the same: B2-C2B2H's Target, task, Search input, child
 * calculation (B2-C2B2G's `runPhase2C26B2C2B2GTask()` itself), two boundary observers, section stream, CPU profiler (10 ms, Search
 * start + 120 s .. + 720 s, JIT default), budget (30 minutes), heap (12,288 MB), concurrency 1, setImmediate yield, 250 ms memory
 * sampling, 5 s heartbeat, no retry and no fallback. The Search child never reads a RESULT, a B2-C2B2H measurement or an
 * expected outcome; the parent reads the B2-C2B2H RESULT and its local raw files only to attest their SHA-256 before the run.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C26B2C2B2HTasks,
  createPhase2C26B2C2B2HProfiler,
  parsePhase2C26B2C2B2HProbeManifest,
  phase2c26b2c2b2hChildSearchIdentity,
  phase2c26b2c2b2hRegisteredConditions,
  phase2c26b2c2b2hTaskIdentity,
  phase2c26b2c2b2hTaskOutcome,
  runPhase2C26B2C2B2HTask,
  PHASE2C26B2C2B2H_CPU_PROFILER,
  PHASE2C26B2C2B2H_NOT_RUN,
  PHASE2C26B2C2B2H_POPULATION,
  PHASE2C26B2C2B2H_PROVENANCE_FLAGS,
  type Phase2C26B2C2B2HTaskInput,
} from './plannerGlobalPhase2C26B2C2B2H'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------- the registered Production optimization

/** The one Production optimization of this phase (fixed before the formal run). */
export const PHASE2C26B2C2B2I_OPTIMIZATION = {
  id: 'predict_keep_nested_counter_family_cache_v1',
  file: 'src/domain/search/bonusStream.ts',
  function: 'predictKeep',
  old: 'Map<composite-string, Prediction>: key `${gogmaCounter}\\u0000${familyLayoutKey}` built on every lookup',
  new: 'Map<counter, Map<family-layout-key, Prediction>>: outer key gogmaCounter, inner key familyLayoutKey, no composite string',
  pair: '(gogmaCounter, familyLayoutKey), unchanged',
  unchanged: ['prediction input', 'familyLayoutKey definition', 'slot order', 'family normalization', 'currentBonuses (the first requesting state\'s five slots)',
    'Reset prediction / memo', 'RNG counters', 'Production RNG', 'memo scope (one createTargetBonusStream() instance)', 'memo lifetime', 'lazy prediction',
    'cache sharing across tiers of one family layout', 'Search ordering', 'Candidate semantics', 'frontier reduction key', 'checkpoint / yield frequency'],
} as const

/** The only Production calculation source this phase may change since B2-C2B2H's measured HEAD. */
export const PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES: readonly string[] = [PHASE2C26B2C2B2I_OPTIMIZATION.file]

/** Research / test paths that are not Production calculation sources. */
export function isPhase2C26B2C2B2IResearchOrTestPath(path: string): boolean {
  return path.startsWith('src/benchmarks/') || path.startsWith('src/test/') || path.startsWith('scripts/') || path.startsWith('docs/')
    || /\.test\.tsx?$/.test(path) || path.startsWith('.github/')
}

/** The Production calculation sources among the paths changed since B2-C2B2H's measured HEAD. */
export const phase2c26b2c2b2iProductionChangedFiles = (changed: readonly string[]): string[] =>
  [...new Set(changed.filter(path => path.length > 0 && !isPhase2C26B2C2B2IResearchOrTestPath(path)))].sort()

const KEEP_MEMO_DECLARATION = /^\s*const keepPredictions = new Map<.*>\(\)\s*$/
const PREDICT_KEEP_DECLARATION = /^ {2}function predictKeep\(\s*$/

/**
 * The source text with the two registered regions of the change replaced by placeholders: the `keepPredictions` declaration
 * (with a one-line doc comment right above it) and `predictKeep()` with its JSDoc. Fails closed (null) when a region is not
 * found exactly once.
 */
export function phase2c26b2c2b2iNormalizeOptimizedRegions(text: string): { normalized: string; predictKeep: string; keepMemoDeclaration: string } | null {
  const lines = text.split(/\r?\n/)
  const memo = lines.flatMap((line, index) => (KEEP_MEMO_DECLARATION.test(line) ? [index] : []))
  const fn = lines.flatMap((line, index) => (PREDICT_KEEP_DECLARATION.test(line) ? [index] : []))
  if (memo.length !== 1 || fn.length !== 1) return null
  let fnStart = fn[0]!
  if (lines[fnStart - 1]?.trim() === '*/') {
    let open = fnStart - 1
    while (open >= 0 && lines[open]!.trim() !== '/**') open -= 1
    if (open < 0) return null
    fnStart = open
  }
  const fnEnd = lines.findIndex((line, index) => index > fn[0]! && line === '  }')
  if (fnEnd < 0) return null
  let memoStart = memo[0]!
  if (/^\s*\/\*\*.*\*\/\s*$/.test(lines[memoStart - 1] ?? '')) memoStart -= 1
  if (memoStart <= fnEnd && memo[0]! >= fnStart) return null
  const out = [...lines]
  const predictKeep = lines.slice(fn[0]!, fnEnd + 1).join('\n')
  const keepMemoDeclaration = lines.slice(memoStart, memo[0]! + 1).join('\n')
  // Replace the later region first so the earlier indexes stay valid.
  const regions = [{ start: fnStart, end: fnEnd, mark: '<<predictKeep>>' }, { start: memoStart, end: memo[0]!, mark: '<<keepPredictions>>' }].sort((a, b) => b.start - a.start)
  for (const region of regions) out.splice(region.start, region.end - region.start + 1, region.mark)
  return { normalized: out.join('\n'), predictKeep, keepMemoDeclaration }
}

export interface Phase2C26B2C2B2ISourceCheck {
  valid: boolean
  issues: string[]
  /** Outside the two registered regions the before / after source texts are identical. */
  onlyRegisteredRegionsChanged: boolean
  beforeHasCompositeKey: boolean
  afterHasCompositeKey: boolean
  afterHasNestedLookup: boolean
  afterDeclaresNestedMemo: boolean
  frontierReductionKeyUnchanged: boolean
  resetMemoUnchanged: boolean
  afterRegistersOnlyAfterPrediction: boolean
}

const COMPOSITE_KEY = '`${gogmaCounter}\\u0000${familyLayoutKey}`'
const FRONTIER_KEY = 'const key = `${state.position}\\u0000${state.familyLayoutKey}`'
const RESET_MEMO = 'const resetPredictions = new Map<number, RestorationBonusSet>()'

/**
 * Whether the change from `before` (B2-C2B2H's measured HEAD) to `after` (this phase's HEAD) of `bonusStream.ts` is exactly the
 * registered optimization: identical outside the Keep memo declaration and `predictKeep()`; the old composite key gone from
 * `predictKeep()`; the nested `get(gogmaCounter)` / `get(familyLayoutKey)` lookup; a `Map<number, Map<string, ...>>` memo; the
 * frontier reduction composite key and the Reset memo untouched; nothing registered before the Engine returned.
 */
export function phase2c26b2c2b2iOptimizationSourceCheck(before: string, after: string): Phase2C26B2C2B2ISourceCheck {
  const issues: string[] = []
  const b = phase2c26b2c2b2iNormalizeOptimizedRegions(before)
  const a = phase2c26b2c2b2iNormalizeOptimizedRegions(after)
  if (b === null) issues.push('the before source has no unique keepPredictions declaration / predictKeep()')
  if (a === null) issues.push('the after source has no unique keepPredictions declaration / predictKeep()')
  const onlyRegisteredRegionsChanged = b !== null && a !== null && b.normalized === a.normalized
  const beforeHasCompositeKey = b !== null && b.predictKeep.includes(COMPOSITE_KEY)
  const afterHasCompositeKey = a !== null && (a.predictKeep.includes(COMPOSITE_KEY) || a.predictKeep.includes('\\u0000'))
  const afterHasNestedLookup = a !== null && a.predictKeep.includes('keepPredictions.get(gogmaCounter)') && a.predictKeep.includes('.get(familyLayoutKey)')
  const afterDeclaresNestedMemo = a !== null && /new Map<number, Map<string, RestorationBonusSet>>\(\)/.test(a.keepMemoDeclaration)
  const count = (text: string, needle: string) => text.split(needle).length - 1
  const frontierReductionKeyUnchanged = count(before, FRONTIER_KEY) === 1 && count(after, FRONTIER_KEY) === 1
  const resetMemoUnchanged = count(before, RESET_MEMO) === 1 && count(after, RESET_MEMO) === 1
  let afterRegistersOnlyAfterPrediction = false
  if (a !== null) {
    const predictedAt = a.predictKeep.indexOf('engine.predictGogmaBonus(')
    const writes = [...a.predictKeep.matchAll(/\.set\(|new Map\(/g)].map(m => m.index!)
    afterRegistersOnlyAfterPrediction = predictedAt > 0 && writes.length > 0 && writes.every(index => index > predictedAt)
  }
  for (const [name, ok] of Object.entries({ onlyRegisteredRegionsChanged, beforeHasCompositeKey, afterHasNestedLookup, afterDeclaresNestedMemo, frontierReductionKeyUnchanged,
    resetMemoUnchanged, afterRegistersOnlyAfterPrediction })) if (!ok) issues.push(`source check: ${name}`)
  if (afterHasCompositeKey) issues.push('source check: predictKeep() still builds a composite key')
  return { valid: issues.length === 0, issues, onlyRegisteredRegionsChanged, beforeHasCompositeKey, afterHasCompositeKey, afterHasNestedLookup, afterDeclaresNestedMemo,
    frontierReductionKeyUnchanged, resetMemoUnchanged, afterRegistersOnlyAfterPrediction }
}

// ---------------------------------------------------------------- Research execution conditions (B2-C2B2H's, unchanged)

/** The population size: the Target B2-C2B2H profiled (counted; the ID comes from the manifest). */
export const PHASE2C26B2C2B2I_TARGETS = 1
export const PHASE2C26B2C2B2I_EXPECTED_TASKS = PHASE2C26B2C2B2I_TARGETS
/** B2-C2B2H's registered conditions (Stage 1, observers, CPU profiler window, Node flags, section stream, ...), unchanged. */
export const phase2c26b2c2b2iB2C2B2HConditions = phase2c26b2c2b2hRegisteredConditions
export const PHASE2C26B2C2B2I_STAGE1 = phase2c26b2c2b2hRegisteredConditions().stage1
export const PHASE2C26B2C2B2I_CPU_PROFILER = PHASE2C26B2C2B2H_CPU_PROFILER
/** The only intended difference from B2-C2B2H's launch: the registered Production optimization at the measured HEAD. */
export const PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H = [`production_optimization:${PHASE2C26B2C2B2I_OPTIMIZATION.id}`] as const
export const PHASE2C26B2C2B2I_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2H_PROVENANCE_FLAGS,
  profilingOnly: false,
  optimization: true,
  productionOptimizationId: PHASE2C26B2C2B2I_OPTIMIZATION.id,
  beforeAuthority: 'B2-C2B2H formal RESULT and its local raw / profile / sections / cpuprofile (SHA-256 checked)',
  absoluteRuntimeComparedWithB2C2B2H: 'only through the semantic-identical common held-aware depth prefix (state_generation section ms); CPU shares of the same classification',
} as const
/** What B2-C2B2I deliberately does not run (B2-C2B2H's list less the one Production optimization it makes). */
export const PHASE2C26B2C2B2I_NOT_RUN = [...PHASE2C26B2C2B2H_NOT_RUN.filter(item => item !== 'production_change' && item !== 'production_optimization'),
  'second_production_optimization', 'frontier_reduction_key_change', 'keep_family_layout_key_optimization', 'reserved_generated_state_optimization',
  'checkpoint_or_yield_change', 'reset_memo_change', 'new_production_instrumentation', 'schema_change', 'persistence_change', 'rng_change', 'b2c2b2h_rerun',
  'b2c2b2h_result_regeneration', 'allocation_profiler'] as const

// ---------------------------------------------------------------- the probe manifest (a Search input)

export const PHASE2C26B2C2B2I_POPULATION = 'B2C2B2H_KEEP_PREDICTION_PROFILED_TARGET'

export interface Phase2C26B2C2B2IProbeManifest {
  phase: string
  /** The B2-C2B2H RESULT the population was derived from, and the B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs its identity chains to (the Search never reads any). */
  b2c2b2hResultSha256: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  population: typeof PHASE2C26B2C2B2I_POPULATION
  policy: 'P1'
  contextSelection: string
  extentRule: string
  exportSha256: string
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'b2c2b2hResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256',
  'extentRule', 'phase', 'policy', 'population', 'probes']

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys, the registered population and a B2-C2B2H RESULT SHA-256;
 * the rest is checked by B2-C2B2H's manifest parser unchanged (one probe, one expected identity, B2-C2B2G / B2-C2B2F / B2-C2B2E
 * RESULT SHA-256s, no expected key / index / cost / outcome / section / hotspot / measurement).
 */
export function parsePhase2C26B2C2B2IProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2IProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2I_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2I_POPULATION}`)
  if (typeof json.b2c2b2hResultSha256 !== 'string' || !SHA256.test(json.b2c2b2hResultSha256)) issues.push('b2c2b2hResultSha256 is not a SHA-256')
  const h = parsePhase2C26B2C2B2HProbeManifest({ phase: json.phase, b2c2b2gResultSha256: json.b2c2b2gResultSha256, b2c2b2fResultSha256: json.b2c2b2fResultSha256,
    b2c2b2eResultSha256: json.b2c2b2eResultSha256, population: PHASE2C26B2C2B2H_POPULATION, policy: json.policy, contextSelection: json.contextSelection, extentRule: json.extentRule,
    exportSha256: json.exportSha256, probes: json.probes, expectedTaskIdentities: json.expectedTaskIdentities })
  issues.push(...h.issues)
  if (issues.length > 0 || h.manifest === null) return { valid: false, issues, manifest: null }
  const m = h.manifest
  return { valid: true, issues: [], manifest: { phase: m.phase, b2c2b2hResultSha256: String(json.b2c2b2hResultSha256), b2c2b2gResultSha256: m.b2c2b2gResultSha256,
    b2c2b2fResultSha256: m.b2c2b2fResultSha256, b2c2b2eResultSha256: m.b2c2b2eResultSha256, population: PHASE2C26B2C2B2I_POPULATION, policy: 'P1', contextSelection: m.contextSelection,
    extentRule: m.extentRule, exportSha256: m.exportSha256, probes: m.probes, expectedTaskIdentities: m.expectedTaskIdentities } }
}

// ---------------------------------------------------------------- task construction, child calculation and profiler (B2-C2B2H's, unchanged)

export type Phase2C26B2C2B2ITaskInput = Phase2C26B2C2B2HTaskInput
export const phase2c26b2c2b2iTaskIdentity = phase2c26b2c2b2hTaskIdentity
export const phase2c26b2c2b2iChildSearchIdentity = phase2c26b2c2b2hChildSearchIdentity
export const phase2c26b2c2b2iTaskOutcome = phase2c26b2c2b2hTaskOutcome
/** The child calculation is B2-C2B2H's (= B2-C2B2G's `runPhase2C26B2C2B2GTask()`, the same function object). */
export const runPhase2C26B2C2B2ITask = runPhase2C26B2C2B2HTask
/** B2-C2B2H's child profiler (B2-C2B2G's + durable section stream + Search start anchor), unchanged. */
export const createPhase2C26B2C2B2IProfiler = createPhase2C26B2C2B2HProfiler

/** B2-C2B2H's `buildPhase2C26B2C2B2HTasks()` unchanged (the identity-gated construction), with this phase's task count. */
export function buildPhase2C26B2C2B2ITasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2IProbeManifest, 'probes' | 'expectedTaskIdentities'>):
  { valid: boolean; issues: string[]; tasks: Phase2C26B2C2B2ITaskInput[] } {
  const built = buildPhase2C26B2C2B2HTasks(schedule, manifest)
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== PHASE2C26B2C2B2I_EXPECTED_TASKS) issues.push(`${built.tasks.length} tasks, not ${PHASE2C26B2C2B2I_EXPECTED_TASKS}`)
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2I_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2I_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2I runner start attestation'

/** The B2-C2B2H formal raw files the before / after comparison reads (their SHA-256 must be the ones the B2-C2B2H RESULT recorded). */
export const PHASE2C26B2C2B2I_BEFORE_FILES = ['run', 'profile', 'sections', 'cpuProfile', 'capture', 'scripts'] as const
export type Phase2C26B2C2B2IBeforeFile = typeof PHASE2C26B2C2B2I_BEFORE_FILES[number]

/** The registered execution conditions of a formal launch: B2-C2B2H's, plus the registered optimization. */
export function phase2c26b2c2b2iRegisteredConditions() {
  return { b2c2b2hConditions: phase2c26b2c2b2hRegisteredConditions(), changedFromB2C2B2H: [...PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H], targets: PHASE2C26B2C2B2I_TARGETS,
    expectedTasks: PHASE2C26B2C2B2I_EXPECTED_TASKS, population: PHASE2C26B2C2B2I_POPULATION, optimization: structuredClone(PHASE2C26B2C2B2I_OPTIMIZATION) as unknown as Json,
    registeredProductionChangedFiles: [...PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES], provenanceFlags: { ...PHASE2C26B2C2B2I_PROVENANCE_FLAGS } }
}

export interface Phase2C26B2C2B2ILaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  exportFileName: string
  exportSha256: string
  exportBytes: number
  probeManifestFileName: string
  probeManifestSha256: string
  probeManifestB2C2B2HResultSha256: string
  probeManifestB2C2B2GResultSha256: string
  probeManifestB2C2B2FResultSha256: string
  probeManifestB2C2B2EResultSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The B2-C2B2H RESULT the parent read, and the local B2-C2B2H raw files it hashed (equal to the RESULT's records, or no formal launch). */
  b2c2b2hResultSha256: string
  b2c2b2hMeasuredHead: string
  b2c2b2hBeforeFiles: Record<Phase2C26B2C2B2IBeforeFile, string>
  /** The Production calculation sources changed since B2-C2B2H's measured HEAD, and the source shape check of the change. */
  productionChangedFiles: string[]
  optimizationSourceCheckValid: boolean
  stage1: { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' }
  cpuProfilerConfig: typeof PHASE2C26B2C2B2I_CPU_PROFILER
  smoke: { budgetMs: number | null; warmupMs: number | null; profileStopMs: number | null } | null
}

export type Phase2C26B2C2B2IStartAttestation = ReturnType<typeof phase2c26b2c2b2iRegisteredConditions> & Phase2C26B2C2B2ILaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c26b2c2b2iStartAttestationBody(observation: Phase2C26B2C2B2ILaunchObservation): Phase2C26B2C2B2IStartAttestation {
  return { phase: PHASE2C26B2C2B2I_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2iRegisteredConditions(), ...observation }
}

const EMPTY_BEFORE = Object.fromEntries(PHASE2C26B2C2B2I_BEFORE_FILES.map(f => [f, ''])) as Record<Phase2C26B2C2B2IBeforeFile, string>
const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2iStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestB2C2B2HResultSha256: '', probeManifestB2C2B2GResultSha256: '',
  probeManifestB2C2B2FResultSha256: '', probeManifestB2C2B2EResultSha256: '', targetWeaponIds: [], probes: [], expectedTaskIdentities: [], b2c2b2hResultSha256: '', b2c2b2hMeasuredHead: '',
  b2c2b2hBeforeFiles: EMPTY_BEFORE, productionChangedFiles: [], optimizationSourceCheckValid: false, stage1: PHASE2C26B2C2B2I_STAGE1, cpuProfilerConfig: PHASE2C26B2C2B2I_CPU_PROFILER,
  smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C26B2C2B2IAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  b2c2b2hResultSha256: string
  b2c2b2hMeasuredHead: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  b2c2b2hBeforeFiles: Readonly<Record<Phase2C26B2C2B2IBeforeFile, string>>
  productionChangedFiles: readonly string[]
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal launch: exactly the attestation keys; runner + B2-C2B2I marker; a canonical UTC
 * `createdAt` no later than the first child start; HEAD / benchmark code / Export / manifest / B2-C2B2H (and its measured HEAD,
 * its local before files), B2-C2B2G, B2-C2B2F and B2-C2B2E RESULTs / Targets / probe / expected identity equal to the
 * independently obtained ones; the Production change exactly the registered file with a valid source shape check; a clean
 * launch with no smoke option; every registered condition (B2-C2B2H's, unchanged) and the registered optimization.
 */
export function verifyPhase2C26B2C2B2IStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2IAttestationExpectation):
  { verified: boolean; issues: string[]; integrityIssues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2I_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2I start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestB2C2B2HResultSha256 !== expected.b2c2b2hResultSha256) integrityIssues.push('probeManifestB2C2B2HResultSha256 is not the registered B2-C2B2H RESULT')
  if (attestation.b2c2b2hResultSha256 !== expected.b2c2b2hResultSha256) integrityIssues.push('b2c2b2hResultSha256 is not the registered B2-C2B2H RESULT')
  if (attestation.b2c2b2hMeasuredHead !== expected.b2c2b2hMeasuredHead) integrityIssues.push('b2c2b2hMeasuredHead is not the registered B2-C2B2H measured HEAD')
  if (attestation.probeManifestB2C2B2GResultSha256 !== expected.b2c2b2gResultSha256) integrityIssues.push('probeManifestB2C2B2GResultSha256 is not the registered B2-C2B2G RESULT')
  if (attestation.probeManifestB2C2B2FResultSha256 !== expected.b2c2b2fResultSha256) integrityIssues.push('probeManifestB2C2B2FResultSha256 is not the registered B2-C2B2F RESULT')
  if (attestation.probeManifestB2C2B2EResultSha256 !== expected.b2c2b2eResultSha256) integrityIssues.push('probeManifestB2C2B2EResultSha256 is not the registered B2-C2B2E RESULT')
  if (!same(attestation.b2c2b2hBeforeFiles, expected.b2c2b2hBeforeFiles)) integrityIssues.push('b2c2b2hBeforeFiles are not the B2-C2B2H RESULT\'s recorded files')
  if (!same(attestation.productionChangedFiles, expected.productionChangedFiles)) integrityIssues.push('productionChangedFiles differ')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  if (!same(attestation.productionChangedFiles, PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES)) launchIssues.push(`the Production change is not exactly ${PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES.join(', ')}`)
  if (attestation.optimizationSourceCheckValid !== true) launchIssues.push('the optimization source check is not valid')
  if (!same(attestation.stage1, PHASE2C26B2C2B2I_STAGE1)) launchIssues.push('stage1 differs from the registered condition')
  if (!same(attestation.cpuProfilerConfig, PHASE2C26B2C2B2I_CPU_PROFILER)) launchIssues.push('cpuProfilerConfig differs from the registered condition')
  for (const [field, value] of Object.entries(phase2c26b2c2b2iRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
