/**
 * Issue #154 Phase 2-C2.6-B2-C2B2J: the second Production optimization of the held-aware `state_generation` hotspot, after
 * B2-C2B2I (`predict_keep_nested_counter_family_cache_v1`, ADOPTED), and its formal before / after check. Research only. Never
 * import from Production.
 *
 * Exactly one Production calculation source changes, and only how a held-aware generated state gets its family layout key:
 *
 * ```text
 * src/domain/search/bonusStream.ts  reservedGeneratedState() and its two call sites in generateReservedDepth()
 *   old  reservedGeneratedState() computes keepFamilyLayoutKey(bonuses) for every generated state (Reset and Keep)
 *   new  the caller passes the key: Reset computes keepFamilyLayoutKey(resetResult); Keep passes the parent's state.familyLayoutKey
 * ```
 *
 * Keep preserves the family of each of the five ordered slots and rerolls only the tier (`docs/RNG_SPEC.md` 6.1), so the key of a
 * Keep result is its parent's key: the value is the same, only its recomputation is gone. Every prediction input / result, the
 * family layout key definition, the frontier reduction key, the representative, the result history, the predictKeep nested memo
 * (B2-C2B2I), the Reset memo, the checkpoint / yield frequency, the Search algorithm, extent, context, P1, the Planner, RNG and UI
 * are untouched.
 *
 * Compared with B2-C2B2I (the formal before evidence) everything else is the same: B2-C2B2I's (= B2-C2B2H's) Target, task, Search
 * input, child calculation (B2-C2B2G's `runPhase2C26B2C2B2GTask()` itself), two boundary observers, section stream, CPU profiler
 * (10 ms, Search start + 120 s .. + 720 s, JIT default), budget (30 minutes), heap (12,288 MB), concurrency 1, setImmediate yield,
 * 250 ms memory sampling, 5 s heartbeat, no retry and no fallback. The Search child never reads a RESULT, a B2-C2B2I measurement or
 * an expected outcome; the parent reads the B2-C2B2I RESULT and its local raw files only to attest their SHA-256 before the run.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C26B2C2B2ITasks,
  createPhase2C26B2C2B2IProfiler,
  isPhase2C26B2C2B2IResearchOrTestPath,
  parsePhase2C26B2C2B2IProbeManifest,
  phase2c26b2c2b2iChildSearchIdentity,
  phase2c26b2c2b2iNormalizeOptimizedRegions,
  phase2c26b2c2b2iTaskIdentity,
  phase2c26b2c2b2iTaskOutcome,
  runPhase2C26B2C2B2ITask,
  PHASE2C26B2C2B2I_BEFORE_FILES,
  PHASE2C26B2C2B2I_CPU_PROFILER,
  PHASE2C26B2C2B2I_NOT_RUN,
  PHASE2C26B2C2B2I_POPULATION,
  PHASE2C26B2C2B2I_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2I_STAGE1,
  type Phase2C26B2C2B2ITaskInput,
} from './plannerGlobalPhase2C26B2C2B2I'
import { phase2c26b2c2b2hRegisteredConditions } from './plannerGlobalPhase2C26B2C2B2H'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------- the registered Production optimization

/** The one Production optimization of this phase (fixed before the formal run). */
export const PHASE2C26B2C2B2J_OPTIMIZATION = {
  id: 'reserved_keep_family_layout_key_reuse_v1',
  file: 'src/domain/search/bonusStream.ts',
  function: 'reservedGeneratedState',
  old: 'reservedGeneratedState() computes familyLayoutKey = keepFamilyLayoutKey(bonuses, master) for every generated held-aware state (Reset and Keep)',
  new: 'reservedGeneratedState() takes familyLayoutKey as an explicit input: the Reset call site computes keepFamilyLayoutKey(resetResult, master), the Keep call site passes the parent state.familyLayoutKey',
  contract: 'docs/RNG_SPEC.md 6.1: Keep preserves the family of each ordered slot and rerolls only the tier, so keepFamilyLayoutKey(keepResult) === keepFamilyLayoutKey(currentBonuses) === parent familyLayoutKey',
  unchanged: ['Keep prediction input', 'Keep prediction result', 'familyLayoutKey definition (keepFamilyLayoutKey / keepFamilyLayout / keepFamilyOfBonus)', 'family normalization',
    'slot order', 'bonus ranks', 'Reset behavior (its key is computed from its result)', 'Production RNG', 'RNG version', 'Search ordering', 'frontier reduction key',
    'frontier grouping semantics', 'representative semantics (compareReservedRepresentative)', 'result history', 'Candidate semantics', 'predictKeep nested memo (B2-C2B2I)',
    'Reset memo', 'checkpoint / yield', 'extent', 'Planner', 'schema / Persistence'],
} as const

/** The only Production calculation source this phase may change since B2-C2B2I's measured HEAD (and since the PR #209 main). */
export const PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES: readonly string[] = [PHASE2C26B2C2B2J_OPTIMIZATION.file]

/** The main commit this phase starts from: PR #209 (test / fixture only: the Planner Alternative fake Keep made RNG_SPEC 6.1 compliant). */
export const PHASE2C26B2C2B2J_BASE_MAIN = { pullRequest: 209, sha: '9ae3f2af2d11844a13aa30e96df0a788a0a2ad12' } as const

/** Research / test paths that are not Production calculation sources (B2-C2B2I's rule, unchanged). */
export const isPhase2C26B2C2B2JResearchOrTestPath = isPhase2C26B2C2B2IResearchOrTestPath

/** The Production calculation sources among the paths changed. */
export const phase2c26b2c2b2jProductionChangedFiles = (changed: readonly string[]): string[] =>
  [...new Set(changed.filter(path => path.length > 0 && !isPhase2C26B2C2B2JResearchOrTestPath(path)))].sort()

const RESERVED_GENERATED_STATE_DECLARATION = /^ {2}function reservedGeneratedState\(\s*$/
const RESET_CALL = /^\s*generated\.push\(reservedGeneratedState\(depth, depth,/
const KEEP_CALL = /^\s*generated\.push\(reservedGeneratedState\(depth, state\.lastResetDepth,/

/**
 * The source text with the three registered regions of the change replaced by placeholders: `reservedGeneratedState()` with its
 * JSDoc, the Reset call site line, and the Keep call site line with the `//` comment lines right above it. Fails closed (null)
 * when a region is not found exactly once.
 */
export function phase2c26b2c2b2jNormalizeOptimizedRegions(text: string):
  { normalized: string; reservedGeneratedState: string; resetCall: string; keepCall: string } | null {
  const lines = text.split(/\r?\n/)
  const fn = lines.flatMap((line, index) => (RESERVED_GENERATED_STATE_DECLARATION.test(line) ? [index] : []))
  const reset = lines.flatMap((line, index) => (RESET_CALL.test(line) ? [index] : []))
  const keep = lines.flatMap((line, index) => (KEEP_CALL.test(line) ? [index] : []))
  if (fn.length !== 1 || reset.length !== 1 || keep.length !== 1) return null
  let fnStart = fn[0]!
  if (lines[fnStart - 1]?.trim() === '*/') {
    let open = fnStart - 1
    while (open >= 0 && lines[open]!.trim() !== '/**') open -= 1
    if (open < 0) return null
    fnStart = open
  }
  const fnEnd = lines.findIndex((line, index) => index > fn[0]! && line === '  }')
  if (fnEnd < 0) return null
  let keepStart = keep[0]!
  while (keepStart > 0 && /^\s*\/\//.test(lines[keepStart - 1]!)) keepStart -= 1
  const regions = [{ start: fnStart, end: fnEnd, mark: '<<reservedGeneratedState>>' }, { start: reset[0]!, end: reset[0]!, mark: '<<resetCall>>' },
    { start: keepStart, end: keep[0]!, mark: '<<keepCall>>' }].sort((a, b) => b.start - a.start)
  for (let i = 1; i < regions.length; i += 1) if (regions[i]!.end >= regions[i - 1]!.start) return null
  const out = [...lines]
  for (const region of regions) out.splice(region.start, region.end - region.start + 1, region.mark)
  return { normalized: out.join('\n'), reservedGeneratedState: lines.slice(fn[0]!, fnEnd + 1).join('\n'), resetCall: lines[reset[0]!]!.trim(), keepCall: lines[keep[0]!]!.trim() }
}

export interface Phase2C26B2C2B2JSourceCheck {
  valid: boolean
  issues: string[]
  /** Outside the three registered regions the before / after source texts are identical. */
  onlyRegisteredRegionsChanged: boolean
  beforeComputesKeyInsideReservedGeneratedState: boolean
  afterReservedGeneratedStateComputesNoKey: boolean
  afterTakesFamilyLayoutKeyParameter: boolean
  afterResetCallComputesKeyFromResult: boolean
  afterKeepCallPassesParentKey: boolean
  /** B2-C2B2I's predictKeep nested memo (declaration and function) is the same text before and after. */
  predictKeepUnchanged: boolean
  frontierReductionKeyUnchanged: boolean
  resetMemoUnchanged: boolean
}

const FRONTIER_KEY = 'const key = `${state.position}\\u0000${state.familyLayoutKey}`'
const RESET_MEMO = 'const resetPredictions = new Map<number, RestorationBonusSet>()'
const KEY_HELPERS = /keepFamilyLayoutKey\(|keepFamilyLayout\(|keepFamilyOfBonus\(/

/**
 * Whether the change from `before` (B2-C2B2I's measured HEAD) to `after` (this phase's HEAD) of `bonusStream.ts` is exactly the
 * registered optimization: identical outside `reservedGeneratedState()` and its two call sites; the before function computed the
 * key and the after one takes it as a `familyLayoutKey: string` parameter and calls no family helper; the Reset call computes
 * `keepFamilyLayoutKey(bonuses, input.master)` from the Reset result; the Keep call passes `state.familyLayoutKey`; the predictKeep
 * nested memo, the frontier reduction key and the Reset memo untouched.
 */
export function phase2c26b2c2b2jOptimizationSourceCheck(before: string, after: string): Phase2C26B2C2B2JSourceCheck {
  const issues: string[] = []
  const b = phase2c26b2c2b2jNormalizeOptimizedRegions(before)
  const a = phase2c26b2c2b2jNormalizeOptimizedRegions(after)
  if (b === null) issues.push('the before source has no unique reservedGeneratedState() / Reset call / Keep call')
  if (a === null) issues.push('the after source has no unique reservedGeneratedState() / Reset call / Keep call')
  const onlyRegisteredRegionsChanged = b !== null && a !== null && b.normalized === a.normalized
  const beforeComputesKeyInsideReservedGeneratedState = b !== null && b.reservedGeneratedState.includes('familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master),')
  const afterReservedGeneratedStateComputesNoKey = a !== null && !KEY_HELPERS.test(a.reservedGeneratedState)
  const afterTakesFamilyLayoutKeyParameter = a !== null && /\n {4}familyLayoutKey: string,\n/.test(a.reservedGeneratedState) && /\n {6}familyLayoutKey,\n/.test(a.reservedGeneratedState)
  const afterResetCallComputesKeyFromResult = a !== null
    && a.resetCall === 'generated.push(reservedGeneratedState(depth, depth, bonuses, keepFamilyLayoutKey(bonuses, input.master), parent?.results ?? null, position, gogmaCounterAfter))'
  const afterKeepCallPassesParentKey = a !== null
    && a.keepCall === 'generated.push(reservedGeneratedState(depth, state.lastResetDepth, bonuses, state.familyLayoutKey, state.results, position, gogmaCounterAfter))'
  const bk = phase2c26b2c2b2iNormalizeOptimizedRegions(before), ak = phase2c26b2c2b2iNormalizeOptimizedRegions(after)
  const predictKeepUnchanged = bk !== null && ak !== null && bk.predictKeep === ak.predictKeep && bk.keepMemoDeclaration === ak.keepMemoDeclaration
    && ak.keepMemoDeclaration.includes('new Map<number, Map<string, RestorationBonusSet>>()')
  const count = (text: string, needle: string) => text.split(needle).length - 1
  const frontierReductionKeyUnchanged = count(before, FRONTIER_KEY) === 1 && count(after, FRONTIER_KEY) === 1
  const resetMemoUnchanged = count(before, RESET_MEMO) === 1 && count(after, RESET_MEMO) === 1
  const checks = { onlyRegisteredRegionsChanged, beforeComputesKeyInsideReservedGeneratedState, afterReservedGeneratedStateComputesNoKey, afterTakesFamilyLayoutKeyParameter,
    afterResetCallComputesKeyFromResult, afterKeepCallPassesParentKey, predictKeepUnchanged, frontierReductionKeyUnchanged, resetMemoUnchanged }
  for (const [name, ok] of Object.entries(checks)) if (!ok) issues.push(`source check: ${name}`)
  return { valid: issues.length === 0, issues, ...checks }
}

// ---------------------------------------------------------------- Research execution conditions (B2-C2B2I's = B2-C2B2H's, unchanged)

export const PHASE2C26B2C2B2J_TARGETS = 1
export const PHASE2C26B2C2B2J_EXPECTED_TASKS = PHASE2C26B2C2B2J_TARGETS
export const PHASE2C26B2C2B2J_STAGE1 = PHASE2C26B2C2B2I_STAGE1
export const PHASE2C26B2C2B2J_CPU_PROFILER = PHASE2C26B2C2B2I_CPU_PROFILER
/** The only intended difference from B2-C2B2I's launch: the registered Production optimization at the measured HEAD. */
export const PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I = [`production_optimization:${PHASE2C26B2C2B2J_OPTIMIZATION.id}`] as const
export const PHASE2C26B2C2B2J_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2I_PROVENANCE_FLAGS,
  absoluteRuntimeComparedWithB2C2B2H: false,
  productionOptimizationId: PHASE2C26B2C2B2J_OPTIMIZATION.id,
  previousProductionOptimizationIds: ['predict_keep_nested_counter_family_cache_v1'],
  beforeAuthority: 'B2-C2B2I formal RESULT (its after run) and its local raw / profile / sections / cpuprofile / capture / scripts (SHA-256 checked)',
  absoluteRuntimeComparedWithB2C2B2I: 'only through the semantic-identical common held-aware depth prefix (state_generation section ms); CPU shares of the same classification',
} as const
/** What B2-C2B2J deliberately does not run. */
export const PHASE2C26B2C2B2J_NOT_RUN: readonly string[] = [...new Set([
  ...PHASE2C26B2C2B2I_NOT_RUN.filter(item => item !== 'keep_family_layout_key_optimization' && item !== 'reserved_generated_state_optimization'),
  'fixture_change', 'frozen_json_regeneration', 'frontier_composite_key_optimization', 'reserved_generated_state_object_shape_change', 'keep_family_helper_change',
  'predict_keep_memo_change', 'planner_change', 'b2c2b2i_rerun', 'b2c2b2i_result_regeneration'])]

// ---------------------------------------------------------------- the probe manifest (a Search input)

export const PHASE2C26B2C2B2J_POPULATION = 'B2C2B2I_ADOPTED_PROFILED_TARGET'

export interface Phase2C26B2C2B2JProbeManifest {
  phase: string
  /** The B2-C2B2I RESULT the population was derived from, and the B2-C2B2H / G / F / E RESULTs its identity chains to (the Search never reads any). */
  b2c2b2iResultSha256: string
  b2c2b2hResultSha256: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  population: typeof PHASE2C26B2C2B2J_POPULATION
  policy: 'P1'
  contextSelection: string
  extentRule: string
  exportSha256: string
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'b2c2b2hResultSha256', 'b2c2b2iResultSha256', 'contextSelection', 'expectedTaskIdentities',
  'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes']

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys, the registered population and a B2-C2B2I RESULT SHA-256; the
 * rest is checked by B2-C2B2I's manifest parser unchanged (one probe, one expected identity, B2-C2B2H / G / F / E RESULT SHA-256s, no
 * expected key / index / cost / outcome / section / hotspot / measurement).
 */
export function parsePhase2C26B2C2B2JProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2JProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2J_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2J_POPULATION}`)
  if (typeof json.b2c2b2iResultSha256 !== 'string' || !SHA256.test(json.b2c2b2iResultSha256)) issues.push('b2c2b2iResultSha256 is not a SHA-256')
  const i = parsePhase2C26B2C2B2IProbeManifest({ phase: json.phase, b2c2b2hResultSha256: json.b2c2b2hResultSha256, b2c2b2gResultSha256: json.b2c2b2gResultSha256,
    b2c2b2fResultSha256: json.b2c2b2fResultSha256, b2c2b2eResultSha256: json.b2c2b2eResultSha256, population: PHASE2C26B2C2B2I_POPULATION, policy: json.policy,
    contextSelection: json.contextSelection, extentRule: json.extentRule, exportSha256: json.exportSha256, probes: json.probes, expectedTaskIdentities: json.expectedTaskIdentities })
  issues.push(...i.issues)
  if (issues.length > 0 || i.manifest === null) return { valid: false, issues, manifest: null }
  const m = i.manifest
  return { valid: true, issues: [], manifest: { phase: m.phase, b2c2b2iResultSha256: String(json.b2c2b2iResultSha256), b2c2b2hResultSha256: m.b2c2b2hResultSha256,
    b2c2b2gResultSha256: m.b2c2b2gResultSha256, b2c2b2fResultSha256: m.b2c2b2fResultSha256, b2c2b2eResultSha256: m.b2c2b2eResultSha256, population: PHASE2C26B2C2B2J_POPULATION,
    policy: 'P1', contextSelection: m.contextSelection, extentRule: m.extentRule, exportSha256: m.exportSha256, probes: m.probes, expectedTaskIdentities: m.expectedTaskIdentities } }
}

// ---------------------------------------------------------------- task construction, child calculation and profiler (B2-C2B2I's = B2-C2B2H's, unchanged)

export type Phase2C26B2C2B2JTaskInput = Phase2C26B2C2B2ITaskInput
export const phase2c26b2c2b2jTaskIdentity = phase2c26b2c2b2iTaskIdentity
export const phase2c26b2c2b2jChildSearchIdentity = phase2c26b2c2b2iChildSearchIdentity
export const phase2c26b2c2b2jTaskOutcome = phase2c26b2c2b2iTaskOutcome
/** The child calculation is B2-C2B2I's (= B2-C2B2G's `runPhase2C26B2C2B2GTask()`, the same function object). */
export const runPhase2C26B2C2B2JTask = runPhase2C26B2C2B2ITask
export const createPhase2C26B2C2B2JProfiler = createPhase2C26B2C2B2IProfiler

/** B2-C2B2I's task construction unchanged (B2-C2B2H's identity-gated construction, one task). */
export function buildPhase2C26B2C2B2JTasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2JProbeManifest, 'probes' | 'expectedTaskIdentities'>) {
  return buildPhase2C26B2C2B2ITasks(schedule, manifest)
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2J_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2J_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2J runner start attestation'

/** The B2-C2B2I formal raw files the before / after comparison reads (their SHA-256 must be the ones the B2-C2B2I RESULT recorded). */
export const PHASE2C26B2C2B2J_BEFORE_FILES = PHASE2C26B2C2B2I_BEFORE_FILES
export type Phase2C26B2C2B2JBeforeFile = typeof PHASE2C26B2C2B2J_BEFORE_FILES[number]

/** The registered execution conditions of a formal launch: B2-C2B2H's (unchanged through B2-C2B2I), plus the registered optimization. */
export function phase2c26b2c2b2jRegisteredConditions() {
  return { b2c2b2hConditions: phase2c26b2c2b2hRegisteredConditions(), changedFromB2C2B2I: [...PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I], targets: PHASE2C26B2C2B2J_TARGETS,
    expectedTasks: PHASE2C26B2C2B2J_EXPECTED_TASKS, population: PHASE2C26B2C2B2J_POPULATION, optimization: structuredClone(PHASE2C26B2C2B2J_OPTIMIZATION) as unknown as Json,
    registeredProductionChangedFiles: [...PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES], baseMain: { ...PHASE2C26B2C2B2J_BASE_MAIN },
    provenanceFlags: { ...PHASE2C26B2C2B2J_PROVENANCE_FLAGS } }
}

export interface Phase2C26B2C2B2JLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  /** The PR #209 main is an ancestor of the measured HEAD. */
  baseMainIsAncestor: boolean
  exportFileName: string
  exportSha256: string
  exportBytes: number
  probeManifestFileName: string
  probeManifestSha256: string
  probeManifestB2C2B2IResultSha256: string
  probeManifestB2C2B2HResultSha256: string
  probeManifestB2C2B2GResultSha256: string
  probeManifestB2C2B2FResultSha256: string
  probeManifestB2C2B2EResultSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The B2-C2B2I excluded current Route key SHA-256 (the child attests its own; the analyzer compares them). */
  b2c2b2iExcludedRouteKeySha256: string
  /** The B2-C2B2I RESULT the parent read, and the local B2-C2B2I raw files it hashed (equal to the RESULT's records, or no formal launch). */
  b2c2b2iResultSha256: string
  b2c2b2iMeasuredHead: string
  b2c2b2iBeforeFiles: Record<Phase2C26B2C2B2JBeforeFile, string>
  /** Production calculation sources: B2-C2B2I measured HEAD -> PR #209 main (must be none), and -> the measured HEAD (must be the registered file). */
  productionChangedB2C2B2IToBaseMain: string[]
  productionChangedFiles: string[]
  optimizationSourceCheckValid: boolean
  stage1: { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' }
  cpuProfilerConfig: typeof PHASE2C26B2C2B2J_CPU_PROFILER
  smoke: { budgetMs: number | null; warmupMs: number | null; profileStopMs: number | null } | null
}

export type Phase2C26B2C2B2JStartAttestation = ReturnType<typeof phase2c26b2c2b2jRegisteredConditions> & Phase2C26B2C2B2JLaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c26b2c2b2jStartAttestationBody(observation: Phase2C26B2C2B2JLaunchObservation): Phase2C26B2C2B2JStartAttestation {
  return { phase: PHASE2C26B2C2B2J_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2jRegisteredConditions(), ...observation }
}

const EMPTY_BEFORE = Object.fromEntries(PHASE2C26B2C2B2J_BEFORE_FILES.map(f => [f, ''])) as Record<Phase2C26B2C2B2JBeforeFile, string>
const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2jStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  baseMainIsAncestor: false, exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestB2C2B2IResultSha256: '',
  probeManifestB2C2B2HResultSha256: '', probeManifestB2C2B2GResultSha256: '', probeManifestB2C2B2FResultSha256: '', probeManifestB2C2B2EResultSha256: '', targetWeaponIds: [], probes: [],
  expectedTaskIdentities: [], b2c2b2iExcludedRouteKeySha256: '', b2c2b2iResultSha256: '', b2c2b2iMeasuredHead: '', b2c2b2iBeforeFiles: EMPTY_BEFORE, productionChangedB2C2B2IToBaseMain: [],
  productionChangedFiles: [], optimizationSourceCheckValid: false, stage1: PHASE2C26B2C2B2J_STAGE1, cpuProfilerConfig: PHASE2C26B2C2B2J_CPU_PROFILER, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C26B2C2B2JAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  b2c2b2iResultSha256: string
  b2c2b2iMeasuredHead: string
  b2c2b2hResultSha256: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  b2c2b2iExcludedRouteKeySha256: string
  b2c2b2iBeforeFiles: Readonly<Record<Phase2C26B2C2B2JBeforeFile, string>>
  productionChangedFiles: readonly string[]
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal launch: exactly the attestation keys; runner + B2-C2B2J marker; a canonical UTC
 * `createdAt` no later than the first child start; HEAD / benchmark code / Export / manifest / B2-C2B2I (its measured HEAD, its local
 * before files, its excluded Route), B2-C2B2H / G / F / E RESULTs / Targets / probe / expected identity equal to the independently
 * obtained ones; the PR #209 main an ancestor of the HEAD; no Production change between B2-C2B2I's measured HEAD and that main; the
 * Production change exactly the registered file with a valid source shape check; a clean launch with no smoke option; every
 * registered condition and the registered optimization.
 */
export function verifyPhase2C26B2C2B2JStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2JAttestationExpectation):
  { verified: boolean; issues: string[]; integrityIssues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2J_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2J start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestB2C2B2IResultSha256 !== expected.b2c2b2iResultSha256) integrityIssues.push('probeManifestB2C2B2IResultSha256 is not the registered B2-C2B2I RESULT')
  if (attestation.b2c2b2iResultSha256 !== expected.b2c2b2iResultSha256) integrityIssues.push('b2c2b2iResultSha256 is not the registered B2-C2B2I RESULT')
  if (attestation.b2c2b2iMeasuredHead !== expected.b2c2b2iMeasuredHead) integrityIssues.push('b2c2b2iMeasuredHead is not the registered B2-C2B2I measured HEAD')
  if (attestation.probeManifestB2C2B2HResultSha256 !== expected.b2c2b2hResultSha256) integrityIssues.push('probeManifestB2C2B2HResultSha256 is not the registered B2-C2B2H RESULT')
  if (attestation.probeManifestB2C2B2GResultSha256 !== expected.b2c2b2gResultSha256) integrityIssues.push('probeManifestB2C2B2GResultSha256 is not the registered B2-C2B2G RESULT')
  if (attestation.probeManifestB2C2B2FResultSha256 !== expected.b2c2b2fResultSha256) integrityIssues.push('probeManifestB2C2B2FResultSha256 is not the registered B2-C2B2F RESULT')
  if (attestation.probeManifestB2C2B2EResultSha256 !== expected.b2c2b2eResultSha256) integrityIssues.push('probeManifestB2C2B2EResultSha256 is not the registered B2-C2B2E RESULT')
  if (attestation.b2c2b2iExcludedRouteKeySha256 !== expected.b2c2b2iExcludedRouteKeySha256) integrityIssues.push('b2c2b2iExcludedRouteKeySha256 is not the B2-C2B2I excluded Route')
  if (!same(attestation.b2c2b2iBeforeFiles, expected.b2c2b2iBeforeFiles)) integrityIssues.push('b2c2b2iBeforeFiles are not the B2-C2B2I RESULT\'s recorded files')
  if (!same(attestation.productionChangedFiles, expected.productionChangedFiles)) integrityIssues.push('productionChangedFiles differ')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  if (attestation.baseMainIsAncestor !== true) launchIssues.push(`the PR #${PHASE2C26B2C2B2J_BASE_MAIN.pullRequest} main is not an ancestor of the measured HEAD`)
  if (!same(attestation.productionChangedB2C2B2IToBaseMain, [])) launchIssues.push('a Production calculation source changed between the B2-C2B2I measured HEAD and the PR #209 main')
  if (!same(attestation.productionChangedFiles, PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES)) launchIssues.push(`the Production change is not exactly ${PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES.join(', ')}`)
  if (attestation.optimizationSourceCheckValid !== true) launchIssues.push('the optimization source check is not valid')
  if (!same(attestation.stage1, PHASE2C26B2C2B2J_STAGE1)) launchIssues.push('stage1 differs from the registered condition')
  if (!same(attestation.cpuProfilerConfig, PHASE2C26B2C2B2J_CPU_PROFILER)) launchIssues.push('cpuProfilerConfig differs from the registered condition')
  for (const [field, value] of Object.entries(phase2c26b2c2b2jRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
