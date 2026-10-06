import { describe, expect, it } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawB2C2B2F from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json?raw'
import rawB2C2B2G from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json?raw'
import rawB2C2B2H from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json?raw'
import rawB2C2B2I from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json?raw'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import { parsePhase2C26B2C2B2FB2C2B2EAuthority, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E } from './plannerGlobalPhase2C26B2C2B2FTargets'
import { parsePhase2C26B2C2B2GB2C2B2FAuthority, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F } from './plannerGlobalPhase2C26B2C2B2GTargets'
import { phase2c26b2c2b2hRegisteredConditions, runPhase2C26B2C2B2HTask, createPhase2C26B2C2B2HProfiler } from './plannerGlobalPhase2C26B2C2B2H'
import { parsePhase2C26B2C2B2HB2C2B2GAuthority, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G } from './plannerGlobalPhase2C26B2C2B2HTargets'
import {
  derivePhase2C26B2C2B2HFunctionSpans,
  derivePhase2C26B2C2B2HStateGenerationBlock,
  PHASE2C26B2C2B2H_BLOCK_MARKERS,
} from './plannerGlobalPhase2C26B2C2B2HCpuProfile'
import type { Phase2C26B2C2B2HProfileAnalysis } from './plannerGlobalPhase2C26B2C2B2HAnalysis'
import { phase2c26b2c2b2iDirectComparison } from './plannerGlobalPhase2C26B2C2B2IAnalysis'
import { parsePhase2C26B2C2B2IB2C2B2HAuthority, phase2c26b2c2b2iPopulation, PHASE2C26B2C2B2I_REGISTERED_B2C2B2H } from './plannerGlobalPhase2C26B2C2B2ITargets'
import { phase2c26b2c2b2iOptimizationSourceCheck, PHASE2C26B2C2B2I_STAGE1, PHASE2C26B2C2B2I_CPU_PROFILER } from './plannerGlobalPhase2C26B2C2B2I'
import {
  buildPhase2C26B2C2B2JTasks,
  createPhase2C26B2C2B2JProfiler,
  parsePhase2C26B2C2B2JProbeManifest,
  phase2c26b2c2b2jNormalizeOptimizedRegions,
  phase2c26b2c2b2jOptimizationSourceCheck,
  phase2c26b2c2b2jProductionChangedFiles,
  phase2c26b2c2b2jRegisteredConditions,
  phase2c26b2c2b2jStartAttestationBody,
  runPhase2C26B2C2B2JTask,
  verifyPhase2C26B2C2B2JStartAttestation,
  PHASE2C26B2C2B2J_BASE_MAIN,
  PHASE2C26B2C2B2J_BEFORE_FILES,
  PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I,
  PHASE2C26B2C2B2J_CPU_PROFILER,
  PHASE2C26B2C2B2J_EXPECTED_TASKS,
  PHASE2C26B2C2B2J_NOT_RUN,
  PHASE2C26B2C2B2J_OPTIMIZATION,
  PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES,
  PHASE2C26B2C2B2J_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2J_STAGE1,
  PHASE2C26B2C2B2J_START_ATTESTATION_PHASE,
  type Phase2C26B2C2B2JAttestationExpectation,
  type Phase2C26B2C2B2JBeforeFile,
} from './plannerGlobalPhase2C26B2C2B2J'
import searchSource from './plannerGlobalPhase2C26B2C2B2J.ts?raw'
import {
  parsePhase2C26B2C2B2JB2C2B2IAuthority,
  phase2c26b2c2b2jPopulation,
  phase2c26b2c2b2jProbeManifest,
  PHASE2C26B2C2B2J_REGISTERED_B2C2B2I,
  PHASE2C26B2C2B2J_TARGET_FUNCTION,
} from './plannerGlobalPhase2C26B2C2B2JTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2JTargets.ts?raw'
import {
  phase2c26b2c2b2jCpuComparison,
  phase2c26b2c2b2jDecision,
  phase2c26b2c2b2jDirectComparison,
  phase2c26b2c2b2jGc,
  phase2c26b2c2b2jRegisteredInclusiveShare,
  PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO,
  PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO,
  PHASE2C26B2C2B2J_DECISION_CASES,
  PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO,
  PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO,
  PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO,
  type Phase2C26B2C2B2JCpuComparison,
  type Phase2C26B2C2B2JDirectComparison,
} from './plannerGlobalPhase2C26B2C2B2JAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2JAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2j-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2j.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2j.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2J: the held-aware Keep family layout key reuse and its formal before / after check against
 * B2-C2B2I. The committed B2-C2B2I / H / G / F / E RESULTs are read only to check the authorities and the population derivation; the
 * synthetic analyses below are invented for the tests. No oracle module is imported here. The stream semantics of the optimization
 * itself is fixed by src/domain/search/reservedKeepFamilyLayoutKeyReuse.test.ts and the PR #209 / B2-C2B2I frozen records.
 */

type Json = Record<string, unknown>
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
const iJson = JSON.parse(rawB2C2B2I)
const parsedH = parsePhase2C26B2C2B2IB2C2B2HAuthority(JSON.parse(rawB2C2B2H), PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256)
const parsedG = parsePhase2C26B2C2B2HB2C2B2GAuthority(JSON.parse(rawB2C2B2G), PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256)
const parsedF = parsePhase2C26B2C2B2GB2C2B2FAuthority(JSON.parse(rawB2C2B2F), PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
const parsedE = parsePhase2C26B2C2B2FB2C2B2EAuthority(JSON.parse(rawB2C2B2E), PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
const iWith = (patch: (j: Json & { decision: Json; provenance: Json; parity: Json; population: Json; conditions: Json; sources: Json; profiles: Json & { after: Json };
  semanticParity: Json; directComparison: Json; cpuHotspot: Json; productionChange: Json }) => void) => {
  const copy = structuredClone(iJson)
  patch(copy)
  return parsePhase2C26B2C2B2JB2C2B2IAuthority(copy, PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256)
}
const authorityI = () => parsePhase2C26B2C2B2JB2C2B2IAuthority(iJson, PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256).authority!

// ---------------------------------------------------------------- the before authority, the chain and the population

describe('Phase 2-C2.6-B2-C2B2J before authority, population and manifest', () => {
  it('reads the committed B2-C2B2I RESULT as the registered formal before authority, failing closed on another SHA-256, case, profile, condition, chain, identity or file record', async () => {
    expect(await sha256(rawB2C2B2I)).toBe(PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256)
    expect(await sha256(rawB2C2B2H)).toBe(PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.b2c2b2hResultSha256)
    expect(await sha256(rawB2C2B2G)).toBe(PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.b2c2b2gResultSha256)
    expect(await sha256(rawB2C2B2F)).toBe(PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.b2c2b2fResultSha256)
    expect(await sha256(rawB2C2B2E)).toBe(PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.b2c2b2eResultSha256)
    const parsed = parsePhase2C26B2C2B2JB2C2B2IAuthority(iJson, PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2I_ADOPTED', measuredHead: PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.measuredHead,
      stateGenerationDirectRatio: iJson.decision.stateGenerationDirectRatio, keepPredictionShareRatio: iJson.decision.keepPredictionShareRatio })
    // The before share is the B2-C2B2I after profile's registered inclusive keepFamilyLayoutKey share, read mechanically (never hard-coded).
    const inclusive = iJson.profiles.after.registeredInclusive.find((r: { registered: string }) => r.registered === PHASE2C26B2C2B2J_TARGET_FUNCTION)
    expect(parsed.authority!.keepFamilyLayoutKeyShareOfActive).toBe(inclusive.shareOfActive)
    expect(parsed.authority!.keepFamilyLayoutKeyShareOfActive).toBeGreaterThan(0.05)
    for (const name of PHASE2C26B2C2B2J_BEFORE_FILES) expect(parsed.authority!.beforeFiles[name]).toEqual({ file: iJson.sources[name].file, sha256: iJson.sources[name].sha256 })
    expect(parsePhase2C26B2C2B2JB2C2B2IAuthority(iJson, '0'.repeat(64)).valid).toBe(false)
    expect(iWith(j => { j.decision.case = 'B2C2B2I_PARTIAL' }).valid).toBe(false)
    expect(iWith(j => { j.decision.adoption = 'undecided' }).valid).toBe(false)
    expect(iWith(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(iWith(j => { j.provenance.evidenceGrade = 'non_formal' }).valid).toBe(false)
    expect(iWith(j => { j.provenance.partialRun = true }).valid).toBe(false)
    expect(iWith(j => { j.provenance.measuredHead = 'f'.repeat(40) }).valid).toBe(false)
    expect(iWith(j => { j.provenance.productionOptimizationId = 'other' }).valid).toBe(false)
    expect(iWith(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(iWith(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(iWith(j => { (j as Json).afterProfileQualityIssues = ['short profile'] }).valid).toBe(false)
    expect(iWith(j => { j.semanticParity.valid = false }).valid).toBe(false)
    expect(iWith(j => { j.directComparison.firstMismatch = { index: 3 } }).valid).toBe(false)
    expect(iWith(j => { j.cpuHotspot.afterProfileValid = false }).valid).toBe(false)
    expect(iWith(j => { j.profiles.after.registeredLineMismatches = ['x'] }).valid).toBe(false)
    expect(iWith(j => { j.profiles.after.registeredInclusive = [] }).valid).toBe(false)
    expect(iWith(j => { j.productionChange.equalsRegistered = false }).valid).toBe(false)
    expect(iWith(j => { j.conditions.stage1 = { ...PHASE2C26B2C2B2I_STAGE1, budgetMs: 3_600_000 } }).valid).toBe(false)
    expect(iWith(j => { j.conditions.cpuProfilerConfig = { ...PHASE2C26B2C2B2I_CPU_PROFILER, warmupMs: 60_000 } }).valid).toBe(false)
    expect(iWith(j => { j.conditions.nodeFlags = ['--max-old-space-size=16384'] }).valid).toBe(false)
    expect(iWith(j => { (j.conditions.conditionChecks as Json).noRetry = false }).valid).toBe(false)
    expect(iWith(j => { (j.parity.hashChain as Json).exportMatchesRunner = false }).valid).toBe(false)
    expect(iWith(j => { (j.parity.childIdentity as Json).searchInputDigest = false }).valid).toBe(false)
    expect(iWith(j => { (j.parity.excludedRoute as Json).childAttestedExcludedRouteKeySha256 = '2'.repeat(64) }).valid).toBe(false)
    expect(iWith(j => { j.provenance.b2c2b2gResultSha256 = '1'.repeat(64) }).valid).toBe(false)
    expect(iWith(j => { j.population.probes = [] }).valid).toBe(false)
    expect(iWith(j => { j.sources.cpuProfile = null }).valid).toBe(false)
    expect(iWith(j => { (j.sources.sections as Json).sha256 = 'x' }).valid).toBe(false)
  })

  it('derives the population mechanically from B2-C2B2I (1 Target) and chains it to the B2-C2B2I-derived (B2-C2B2H / G / F / E) probe, identity and excluded Route', () => {
    const i = authorityI()
    const derived = phase2c26b2c2b2jPopulation(i, parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
    expect(derived.issues).toEqual([])
    expect(Object.values(derived.chain).every(v => v === true)).toBe(true)
    expect(derived.targetWeaponIds).toEqual(iJson.population.targetWeaponIds)
    expect(derived.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2J_EXPECTED_TASKS)
    expect(derived.probes).toEqual(iJson.population.probes)
    expect(derived.expectedTaskIdentities).toEqual([iJson.parity.identity.expected])
    const fromI = phase2c26b2c2b2iPopulation(parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
    expect(derived.probes).toEqual(fromI.probes)
    expect(derived.expectedTaskIdentities).toEqual(fromI.expectedTaskIdentities)
    expect(derived.excludedRouteKeySha256).toBe(fromI.excludedRouteKeySha256)
    const h = parsedH.authority!
    expect(phase2c26b2c2b2jPopulation({ ...i, probes: [{ ...i.probes[0]!, contextRank: i.probes[0]!.contextRank + 1 }] }, h, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/probesEqualB2C2B2IDerived/)
    expect(phase2c26b2c2b2jPopulation({ ...i, expectedTaskIdentities: [{ ...i.expectedTaskIdentities[0]!, searchInputDigest: 'x' }] }, h, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/identitiesEqualB2C2B2IDerived/)
    expect(phase2c26b2c2b2jPopulation({ ...i, excludedRouteKeySha256: '3'.repeat(64) }, h, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/excludedRouteEqualsB2C2B2IDerived/)
    expect(phase2c26b2c2b2jPopulation({ ...i, exportSha256: '4'.repeat(64) }, h, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/exportEqualsB2C2B2H/)
    expect(phase2c26b2c2b2jPopulation({ ...i, b2c2b2hResultSha256: '5'.repeat(64) }, h, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/b2c2b2hAuthorityIsB2C2B2IAuthority/)
    expect(phase2c26b2c2b2jPopulation({ ...i, decisionCase: 'B2C2B2I_PARTIAL' }, h, parsedG.authority, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2jPopulation({ ...i, targetWeaponIds: [] }, h, parsedG.authority, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2jPopulation(null, h, parsedG.authority, parsedF.authority, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
    expect(phase2c26b2c2b2jPopulation(i, null, parsedG.authority, parsedF.authority, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('writes the probe and its expected Search input identity only (B2-C2B2I\'s Search input), exactly what the runner accepts', () => {
    const manifest = phase2c26b2c2b2jProbeManifest(authorityI(), parsedH.authority!, parsedG.authority!, parsedF.authority!, parsedE.authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'b2c2b2hResultSha256', 'b2c2b2iResultSha256', 'contextSelection',
      'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ b2c2b2iResultSha256: PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256, population: 'B2C2B2I_ADOPTED_PROFILED_TARGET', exportSha256: iJson.provenance.exportSha256 })
    // The same Search input as B2-C2B2I: its attested probe and expected identity.
    expect(manifest.probes).toEqual(iJson.provenance.startAttestation.body.probes)
    expect(manifest.expectedTaskIdentities).toEqual(iJson.provenance.startAttestation.body.expectedTaskIdentities)
    expect(JSON.stringify(manifest.probes) + JSON.stringify(manifest.expectedTaskIdentities)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|oracle|timeout|memory|heap|yield|wall|section|dominant|state_generation|hotspot|sample|category|keep_prediction|familyLayout/i)
    expect(parsePhase2C26B2C2B2JProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2JProbeManifest(copy).valid }
    expect(bad(m => { m.probes = [] })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.contextRank += 1 })).toBe(false)
    expect(bad(m => { (m as Json).population = 'B2C2B2H_KEEP_PREDICTION_PROFILED_TARGET' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2iResultSha256 = 'x' })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedHotspot', 'b2c2b2iStateGenerationMs', 'keepFamilyLayoutKeyShare']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- the registered optimization and the Production change

const NEW_RESET_CALL = 'generated.push(reservedGeneratedState(depth, depth, bonuses, keepFamilyLayoutKey(bonuses, input.master), parent?.results ?? null, position, gogmaCounterAfter))'
const OLD_RESET_CALL = 'generated.push(reservedGeneratedState(depth, depth, bonuses, parent?.results ?? null, position, gogmaCounterAfter))'
const NEW_KEEP_CALL = [
  '        // Keep preserves the family of every slot (RNG_SPEC 6.1), so the result',
  '        // has the parent\'s ordered family layout; it is reused, not recomputed.',
  '        generated.push(reservedGeneratedState(depth, state.lastResetDepth, bonuses, state.familyLayoutKey, state.results, position, gogmaCounterAfter))',
].join('\n')
const OLD_KEEP_CALL = '        generated.push(reservedGeneratedState(depth, state.lastResetDepth, bonuses, state.results, position, gogmaCounterAfter))'
const OLD_FN = [
  '  function reservedGeneratedState(',
  '    depth: number,',
  '    lastResetDepth: number,',
  '    bonuses: RestorationBonusSet,',
  '    previous: ReservedBonusResultNode | null,',
  '    position: number,',
  '    gogmaCounterAfter: number,',
  '  ): ReservedBonusState {',
  '    return {',
  '      depth,',
  '      lastResetDepth,',
  '      bonuses,',
  '      scope: \'gogma_artian\',',
  '      familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master),',
].join('\n')
/** The current reservedGeneratedState() head (JSDoc through the familyLayoutKey field), cut from the source. */
const currentFnHead = () => {
  const lines = bonusStreamSource.split('\n')
  const fn = lines.findIndex(l => l === '  function reservedGeneratedState(')
  let start = fn - 1
  while (lines[start]!.trim() !== '/**') start -= 1
  const end = lines.findIndex((l, i) => i > fn && l === '      familyLayoutKey,')
  return lines.slice(start, end + 1).join('\n')
}
/** bonusStream.ts as it was before the optimization (B2-C2B2I's measured HEAD text restored into the current text). */
const beforeSource = () => bonusStreamSource.replace(NEW_RESET_CALL, OLD_RESET_CALL).replace(NEW_KEEP_CALL, OLD_KEEP_CALL).replace(currentFnHead(), OLD_FN)

describe('Phase 2-C2.6-B2-C2B2J registered optimization and Production change', () => {
  it('registers exactly one optimization of one Production file, from the PR #209 main, with B2-C2B2I\'s (= B2-C2B2H\'s) conditions otherwise unchanged', () => {
    expect(PHASE2C26B2C2B2J_OPTIMIZATION.id).toBe('reserved_keep_family_layout_key_reuse_v1')
    expect(PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES).toEqual(['src/domain/search/bonusStream.ts'])
    expect(PHASE2C26B2C2B2J_BASE_MAIN).toEqual({ pullRequest: 209, sha: '9ae3f2af2d11844a13aa30e96df0a788a0a2ad12' })
    expect(PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I).toEqual(['production_optimization:reserved_keep_family_layout_key_reuse_v1'])
    expect(PHASE2C26B2C2B2J_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2J_STAGE1).toEqual(PHASE2C26B2C2B2I_STAGE1)
    expect(PHASE2C26B2C2B2J_CPU_PROFILER).toEqual({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 })
    expect(phase2c26b2c2b2jRegisteredConditions().b2c2b2hConditions).toEqual(phase2c26b2c2b2hRegisteredConditions())
    expect(phase2c26b2c2b2hRegisteredConditions()).toMatchObject({ nodeFlags: ['--max-old-space-size=12288'], searchInstrumentation: { onSearchRuntime: true, onGogmaReservedRuntime: true,
      onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false }, nodeYield: 'setImmediate', memorySampleIntervalMs: 250, heartbeatIntervalMs: 5_000 })
    expect(PHASE2C26B2C2B2J_PROVENANCE_FLAGS).toMatchObject({ optimization: true, productionOptimizationId: PHASE2C26B2C2B2J_OPTIMIZATION.id,
      previousProductionOptimizationIds: ['predict_keep_nested_counter_family_cache_v1'], oracleReadBySearchChild: false, expectedOutcomeKnownBySearchChild: false, routeExactJudged: false,
      cpuProfiling: true })
    for (const notRun of ['fixture_change', 'frozen_json_regeneration', 'frontier_composite_key_optimization', 'reserved_generated_state_object_shape_change', 'keep_family_helper_change',
      'predict_keep_memo_change', 'search_semantics_change', 'planner_change', 'rng_change', 'schema_change', 'extent_change', 'p1_change', 'no_inlining_diagnostic',
      'heap_allocation_profiler', 'heap_snapshot', 'heap_16gb', 'budget_60min_or_more', 'retry', 'timeout_fallback', 'global_assignment', 'full_planner_rerun', 'ui_change',
      'exact_route_judgement', 'b2c2b2i_rerun']) expect(PHASE2C26B2C2B2J_NOT_RUN).toContain(notRun)
    expect(PHASE2C26B2C2B2J_NOT_RUN).not.toContain('production_optimization')
    expect(new Set(PHASE2C26B2C2B2J_NOT_RUN).size).toBe(PHASE2C26B2C2B2J_NOT_RUN.length)
  })

  it('counts only Production calculation sources as a Production change', () => {
    expect(phase2c26b2c2b2jProductionChangedFiles(['src/domain/search/bonusStream.ts', 'src/benchmarks/plannerGlobalPhase2C26B2C2B2J.ts', 'scripts/run-planner-global-phase2c26b2c2b2j.mjs',
      'src/domain/search/reservedKeepFamilyLayoutKeyReuse.test.ts', 'src/test/fixtures/plannerAlternativeFrontier.ts', 'docs/x.md', ''])).toEqual(['src/domain/search/bonusStream.ts'])
    expect(phase2c26b2c2b2jProductionChangedFiles(['src/domain/search/bonusStream.ts', 'src/domain/rng/gogmaBonusFamily.ts'])).toEqual(['src/domain/rng/gogmaBonusFamily.ts', 'src/domain/search/bonusStream.ts'])
  })

  it('accepts exactly the registered change: identical outside reservedGeneratedState() and its two call sites, the key passed in, Reset computing it, Keep reusing the parent\'s, predictKeep / frontier key / Reset memo untouched', () => {
    const before = beforeSource()
    expect(before).not.toBe(bonusStreamSource)
    expect(before).toContain('      familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master),\n      results: {\n        depth,\n        result: { restorationBonuses: bonuses, restorationBonusScope: \'gogma_artian\' },\n        previous,\n        step:')
    const check = phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource)
    expect(check).toEqual({ valid: true, issues: [], onlyRegisteredRegionsChanged: true, beforeComputesKeyInsideReservedGeneratedState: true, afterReservedGeneratedStateComputesNoKey: true,
      afterTakesFamilyLayoutKeyParameter: true, afterResetCallComputesKeyFromResult: true, afterKeepCallPassesParentKey: true, predictKeepUnchanged: true,
      frontierReductionKeyUnchanged: true, resetMemoUnchanged: true })
    // B2-C2B2I's own source check (predictKeep regions) still sees nothing changed outside its regions but this phase's.
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, bonusStreamSource).issues).toContain('source check: onlyRegisteredRegionsChanged')
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before.replace(/\n/g, '\r\n'), bonusStreamSource).valid).toBe(true)
    // Fail closed: a change outside the regions, the frontier key, the Reset memo, predictKeep, a key recomputed inside the function, a Keep recomputation, no change.
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('const resetSupport = predictionSupport.gogmaReset()', 'const resetSupport = predictionSupport.gogmaReset() ')).issues).toContain('source check: onlyRegisteredRegionsChanged')
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('const key = `${state.position}\\u0000${state.familyLayoutKey}`', 'const key = `${state.position}|${state.familyLayoutKey}`')).issues)
      .toEqual(expect.arrayContaining(['source check: onlyRegisteredRegionsChanged', 'source check: frontierReductionKeyUnchanged']))
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('const resetPredictions = new Map<number, RestorationBonusSet>()', 'const resetPredictions = new Map<string, RestorationBonusSet>()')).valid).toBe(false)
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('const cached = byFamilyLayout?.get(familyLayoutKey)', 'const cached = byFamilyLayout?.get(familyLayoutKey) ?? undefined')).issues)
      .toContain('source check: predictKeepUnchanged')
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('      familyLayoutKey,\n      results:', '      familyLayoutKey: keepFamilyLayoutKey(bonuses, input.master),\n      results:')).issues)
      .toEqual(expect.arrayContaining(['source check: afterReservedGeneratedStateComputesNoKey']))
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace('bonuses, state.familyLayoutKey, state.results', 'bonuses, keepFamilyLayoutKey(bonuses, input.master), state.results')).issues)
      .toContain('source check: afterKeepCallPassesParentKey')
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, bonusStreamSource.replace(NEW_RESET_CALL, NEW_RESET_CALL.replace('keepFamilyLayoutKey(bonuses, input.master)', 'parent?.familyLayoutKey ?? \'\''))).issues)
      .toContain('source check: afterResetCallComputesKeyFromResult')
    expect(phase2c26b2c2b2jOptimizationSourceCheck(before, before).valid).toBe(false)
    expect(phase2c26b2c2b2jOptimizationSourceCheck(bonusStreamSource, bonusStreamSource).issues).toContain('source check: beforeComputesKeyInsideReservedGeneratedState')
    expect(phase2c26b2c2b2jNormalizeOptimizedRegions('no function here')).toBeNull()
  })

  it('keeps the CPU profile structure derivable: the registered spans and the state_generation sub-block markers of the current source', () => {
    const spans = derivePhase2C26B2C2B2HFunctionSpans({ 'src/domain/search/bonusStream.ts': bonusStreamSource, 'src/domain/rng/gogmaBonusFamily.ts': 'export function keepFamilyLayoutKey(\n}\nexport function keepFamilyLayout(\n}\n',
      'src/domain/search/searchExecution.ts': '', 'src/domain/rng/production/productionRngEngine.ts': '' }, [{ file: 'src/domain/search/bonusStream.ts', functionName: 'reservedGeneratedState', declaration: 'function' }])
    expect(spans[0]!.startLine).toBe(bonusStreamSource.split('\n').findIndex(l => l === '  function reservedGeneratedState(') + 1)
    const block = derivePhase2C26B2C2B2HStateGenerationBlock(bonusStreamSource, PHASE2C26B2C2B2H_BLOCK_MARKERS)
    expect(block.subBlocks.map(s => s.label)).toEqual(expect.arrayContaining(['reset_state_construction', 'keep_prediction', 'keep_state_construction']))
  })
})

// ---------------------------------------------------------------- task construction and child calculation

describe('Phase 2-C2.6-B2-C2B2J task construction and child calculation', () => {
  it('is B2-C2B2I\'s (= B2-C2B2H\'s = B2-C2B2G\'s) child calculation and profiler, the same function objects', () => {
    expect(runPhase2C26B2C2B2JTask).toBe(runPhase2C26B2C2B2HTask)
    expect(createPhase2C26B2C2B2JProfiler).toBe(createPhase2C26B2C2B2HProfiler)
    expect(searchSource).toMatch(/return buildPhase2C26B2C2B2ITasks\(schedule, manifest\)/)
    expect(buildPhase2C26B2C2B2JTasks).toBeTypeOf('function')
    expect(phase2c26b2c2b2jDirectComparison).toBe(phase2c26b2c2b2iDirectComparison)
  })
})

// ---------------------------------------------------------------- the CPU comparison and the decision

const analysisWith = (keyShare: number | null, gc = 0.2): Phase2C26B2C2B2HProfileAnalysis => ({ activeSamples: 1000,
  categories: [{ category: 'gc', samples: gc * 1000, shareOfActive: gc, shareOfInterval: gc }, { category: 'program', samples: 300, shareOfActive: 0.3, shareOfInterval: 0.3 }],
  registeredInclusive: keyShare === null ? [] : [{ registered: PHASE2C26B2C2B2J_TARGET_FUNCTION, role: 'state_construction', samples: keyShare * 1000, shareOfActive: keyShare }],
  lineTicks: [] }) as unknown as Phase2C26B2C2B2HProfileAnalysis
const directWith = (ratio: number | null, patch: Partial<Phase2C26B2C2B2JDirectComparison> = {}): Phase2C26B2C2B2JDirectComparison => ({ valid: ratio !== null, issues: [], semanticParity: true,
  beforeDepths: 10, afterDepths: 12, commonDepths: 10, firstMismatch: null, commonGeneratedStates: 1000, beforeStateGenerationMs: 100, afterStateGenerationMs: ratio === null ? null : 100 * ratio,
  stateGenerationDirectRatio: ratio, beforeNsPerGeneratedState: null, afterNsPerGeneratedState: null, byThird: [], otherSections: [], inclusive: { beforeMs: 0, afterMs: 0, ratio: null }, ...patch })
const cpuWith = (keyRatio: number | null, patch: Partial<Phase2C26B2C2B2JCpuComparison> = {}): Phase2C26B2C2B2JCpuComparison => ({ beforeRecordedShare: 0.08, beforeRecomputedShare: 0.08,
  beforeReproduced: true, beforeProfileValid: true, beforeQualityIssues: [], afterShare: keyRatio === null ? null : 0.08 * keyRatio, afterProfileValid: keyRatio !== null, afterQualityIssues: [],
  keepFamilyLayoutKeyShareRatio: keyRatio, descriptiveShareRatio: keyRatio, registeredInclusive: [], categories: [], ...patch })
const decide = (direct: Phase2C26B2C2B2JDirectComparison | null, cpu: Phase2C26B2C2B2JCpuComparison | null, invalid: string[] = [], identityParity = true) =>
  phase2c26b2c2b2jDecision({ invalidReasons: invalid, identityParity, direct, cpu })

describe('Phase 2-C2.6-B2-C2B2J CPU target comparison and the pre-registered decision', () => {
  it('uses the after / before keepFamilyLayoutKey registered inclusive share only when both profiles pass the quality rule and the before re-analysis reproduces the RESULT', () => {
    expect(phase2c26b2c2b2jRegisteredInclusiveShare(analysisWith(0.08))).toBe(0.08)
    expect(phase2c26b2c2b2jRegisteredInclusiveShare(analysisWith(null))).toBe(0)
    expect(phase2c26b2c2b2jRegisteredInclusiveShare(null)).toBeNull()
    const ok = phase2c26b2c2b2jCpuComparison({ beforeRecordedShare: 0.08, beforeAnalysis: analysisWith(0.08), beforeQualityIssues: [], afterAnalysis: analysisWith(0.02), afterQualityIssues: [] })
    expect(ok).toMatchObject({ beforeReproduced: true, beforeProfileValid: true, afterProfileValid: true, afterShare: 0.02, keepFamilyLayoutKeyShareRatio: 0.25, descriptiveShareRatio: 0.25 })
    expect(ok.registeredInclusive).toEqual([{ registered: PHASE2C26B2C2B2J_TARGET_FUNCTION, beforeShareOfActive: 0.08, afterShareOfActive: 0.02, beforeSamples: 80, afterSamples: 20 }])
    // The target function absent from the after profile is a 0 share (fully removed), never a missing value.
    expect(phase2c26b2c2b2jCpuComparison({ beforeRecordedShare: 0.08, beforeAnalysis: analysisWith(0.08), beforeQualityIssues: [], afterAnalysis: analysisWith(null), afterQualityIssues: [] }))
      .toMatchObject({ afterShare: 0, keepFamilyLayoutKeyShareRatio: 0 })
    const short = phase2c26b2c2b2jCpuComparison({ beforeRecordedShare: 0.08, beforeAnalysis: analysisWith(0.08), beforeQualityIssues: [], afterAnalysis: analysisWith(0.02), afterQualityIssues: ['the profile spans 1 ms'] })
    expect(short).toMatchObject({ afterProfileValid: false, keepFamilyLayoutKeyShareRatio: null, descriptiveShareRatio: 0.25 })
    const drift = phase2c26b2c2b2jCpuComparison({ beforeRecordedShare: 0.08, beforeAnalysis: analysisWith(0.081), beforeQualityIssues: [], afterAnalysis: analysisWith(0.02), afterQualityIssues: [] })
    expect(drift).toMatchObject({ beforeReproduced: false, beforeProfileValid: false, keepFamilyLayoutKeyShareRatio: null })
    expect(phase2c26b2c2b2jGc(analysisWith(0.08, 0.2), analysisWith(0.02, 0.1))).toMatchObject({ before: { samples: 200, shareOfActive: 0.2 }, after: { samples: 100, shareOfActive: 0.1 }, shareRatio: 0.5 })
  })

  it('fixes the thresholds 0.50 / 0.95 / 1.05 / 0.90 & 0.98 and the case order: INVALID, INSUFFICIENT, REJECTED_SEMANTIC, ADOPTED, REJECTED_REGRESSION, REJECTED_NO_EFFECT, PARTIAL', () => {
    expect([PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO, PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO, PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO, PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO,
      PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO]).toEqual([0.5, 0.95, 1.05, 0.9, 0.98])
    expect(PHASE2C26B2C2B2J_DECISION_CASES).toEqual(['B2C2B2J_INVALID', 'B2C2B2J_INSUFFICIENT', 'B2C2B2J_REJECTED_SEMANTIC', 'B2C2B2J_ADOPTED', 'B2C2B2J_REJECTED_REGRESSION',
      'B2C2B2J_REJECTED_NO_EFFECT', 'B2C2B2J_PARTIAL'])
    // ADOPTED at both boundaries (inclusive), never past either.
    expect(decide(directWith(0.95), cpuWith(0.5))).toMatchObject({ case: 'B2C2B2J_ADOPTED', adoption: 'adopt', stateGenerationDirectRatio: 0.95, keepFamilyLayoutKeyShareRatio: 0.5 })
    expect(decide(directWith(0.5), cpuWith(0)).case).toBe('B2C2B2J_ADOPTED')
    expect(decide(directWith(0.9500001), cpuWith(0.1)).case).toBe('B2C2B2J_PARTIAL')
    expect(decide(directWith(0.5), cpuWith(0.5000001)).case).toBe('B2C2B2J_PARTIAL')
    // A profile missing the quality rule is INSUFFICIENT (no usable CPU pair), never ADOPTED.
    expect(decide(directWith(0.5), cpuWith(0.1, { afterProfileValid: false, keepFamilyLayoutKeyShareRatio: null })).case).toBe('B2C2B2J_INSUFFICIENT')
    expect(decide(directWith(0.5), cpuWith(0.1, { beforeProfileValid: false, keepFamilyLayoutKeyShareRatio: null })).case).toBe('B2C2B2J_INSUFFICIENT')
    expect(decide(directWith(0.5), null)).toMatchObject({ case: 'B2C2B2J_INSUFFICIENT', adoption: 'undecided' })
    // Regression: strictly above 1.05, whatever the CPU share.
    expect(decide(directWith(1.05), cpuWith(1)).case).toBe('B2C2B2J_REJECTED_NO_EFFECT')
    expect(decide(directWith(1.0500001), cpuWith(0.1))).toMatchObject({ case: 'B2C2B2J_REJECTED_REGRESSION', adoption: 'reject' })
    // No effect: key >= 0.90 AND direct >= 0.98.
    expect(decide(directWith(0.98), cpuWith(0.9))).toMatchObject({ case: 'B2C2B2J_REJECTED_NO_EFFECT', adoption: 'reject' })
    expect(decide(directWith(0.9799), cpuWith(0.9)).case).toBe('B2C2B2J_PARTIAL')
    expect(decide(directWith(0.98), cpuWith(0.8999)).case).toBe('B2C2B2J_PARTIAL')
    // Semantic mismatch rejects whatever the speed; INVALID and INSUFFICIENT come first.
    const mismatch = directWith(0.3, { semanticParity: false, firstMismatch: { index: 4, before: {}, after: {} } })
    expect(decide(mismatch, cpuWith(0.1))).toMatchObject({ case: 'B2C2B2J_REJECTED_SEMANTIC', adoption: 'reject' })
    expect(decide(directWith(0.3), cpuWith(0.1), [], false)).toMatchObject({ case: 'B2C2B2J_REJECTED_SEMANTIC', adoption: 'reject' })
    expect(decide(mismatch, cpuWith(0.1), ['hash_chain: x'])).toMatchObject({ case: 'B2C2B2J_INVALID', adoption: 'undecided' })
    expect(decide(null, cpuWith(0.1)).case).toBe('B2C2B2J_INSUFFICIENT')
    expect(decide(directWith(null, { issues: ['no common held-aware depth record'], semanticParity: false }), cpuWith(0.1)).case).toBe('B2C2B2J_INSUFFICIENT')
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't05-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const OBS_IDENTITIES: Phase2C26B2C2B2FTaskIdentity[] = [{ taskId: 't05-r03', targetWeaponId: 't1', contextRank: 3, groupIndex: 1, reservationDigest: 'r', targetEligibleMinCardinality: 1,
  representativeFixedSetId: 'k', representativeFixedTargetWeaponIds: ['t9'], defaultSearchInputDigest: 'd', searchInputDigest: 's', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const BEFORE_FILES = Object.fromEntries(PHASE2C26B2C2B2J_BEFORE_FILES.map((name, index) => [name, String(index).repeat(64)])) as Record<Phase2C26B2C2B2JBeforeFile, string>
const reg = PHASE2C26B2C2B2J_REGISTERED_B2C2B2I
const ROUTE = 'e'.repeat(64)
const observation0 = { createdAt: '2026-10-06T15:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2j.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), baseMainIsAncestor: true, exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local',
  probeManifestSha256: 'd'.repeat(64), probeManifestB2C2B2IResultSha256: reg.resultSha256, probeManifestB2C2B2HResultSha256: reg.b2c2b2hResultSha256,
  probeManifestB2C2B2GResultSha256: reg.b2c2b2gResultSha256, probeManifestB2C2B2FResultSha256: reg.b2c2b2fResultSha256, probeManifestB2C2B2EResultSha256: reg.b2c2b2eResultSha256,
  targetWeaponIds: ['t1'], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, b2c2b2iExcludedRouteKeySha256: ROUTE, b2c2b2iResultSha256: reg.resultSha256,
  b2c2b2iMeasuredHead: reg.measuredHead, b2c2b2iBeforeFiles: { ...BEFORE_FILES }, productionChangedB2C2B2IToBaseMain: [], productionChangedFiles: [...PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES],
  optimizationSourceCheckValid: true, stage1: { ...PHASE2C26B2C2B2J_STAGE1 }, cpuProfilerConfig: { ...PHASE2C26B2C2B2J_CPU_PROFILER }, smoke: null }
const expectation: Phase2C26B2C2B2JAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2iResultSha256: reg.resultSha256, b2c2b2iMeasuredHead: reg.measuredHead, b2c2b2hResultSha256: reg.b2c2b2hResultSha256, b2c2b2gResultSha256: reg.b2c2b2gResultSha256,
  b2c2b2fResultSha256: reg.b2c2b2fResultSha256, b2c2b2eResultSha256: reg.b2c2b2eResultSha256, b2c2b2iExcludedRouteKeySha256: ROUTE, b2c2b2iBeforeFiles: BEFORE_FILES,
  productionChangedFiles: [...PHASE2C26B2C2B2J_PRODUCTION_CHANGED_FILES], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, firstChildStartedAt: '2026-10-06T15:00:00.100Z' }

describe('Phase 2-C2.6-B2-C2B2J runner start attestation', () => {
  it('verifies a clean formal launch and fails closed on every attested field, the before files, the base main, the Production change, the source check and the registered conditions', () => {
    const body = phase2c26b2c2b2jStartAttestationBody(observation0)
    expect(body).toMatchObject({ phase: PHASE2C26B2C2B2J_START_ATTESTATION_PHASE, attestedBy: 'runner', changedFromB2C2B2I: [...PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I],
      baseMain: PHASE2C26B2C2B2J_BASE_MAIN, optimization: { id: 'reserved_keep_family_layout_key_reuse_v1' } })
    expect(verifyPhase2C26B2C2B2JStartAttestation(body, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const fails = (patch: Json, expected: Partial<Phase2C26B2C2B2JAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2JStartAttestation({ ...structuredClone(body), ...patch }, { ...expectation, ...expected }).verified === false
    expect(fails({ createdAt: '2026-10-06T15:00:01.000Z' })).toBe(true)
    expect(fails({ repositoryHead: 'e'.repeat(40) })).toBe(true)
    expect(fails({ benchmarkCodeSha256: 'x' })).toBe(true)
    expect(fails({ exportSha256: 'x' })).toBe(true)
    expect(fails({ probeManifestSha256: 'x' })).toBe(true)
    expect(fails({ b2c2b2iResultSha256: '9'.repeat(64) })).toBe(true)
    expect(fails({ b2c2b2iMeasuredHead: 'f'.repeat(40) })).toBe(true)
    expect(fails({ probeManifestB2C2B2HResultSha256: '9'.repeat(64) })).toBe(true)
    expect(fails({ b2c2b2iExcludedRouteKeySha256: '7'.repeat(64) })).toBe(true)
    expect(fails({ b2c2b2iBeforeFiles: { ...BEFORE_FILES, cpuProfile: 'e'.repeat(64) } })).toBe(true)
    expect(fails({ baseMainIsAncestor: false })).toBe(true)
    expect(fails({ productionChangedB2C2B2IToBaseMain: ['src/domain/search/bonusStream.ts'] })).toBe(true)
    expect(fails({ productionChangedFiles: ['src/domain/search/bonusStream.ts', 'src/domain/rng/gogmaBonusFamily.ts'] })).toBe(true)
    expect(fails({}, { productionChangedFiles: ['src/domain/rng/gogmaBonusFamily.ts'] })).toBe(true)
    expect(fails({ optimizationSourceCheckValid: false })).toBe(true)
    expect(fails({ uncommittedBenchmarkCode: true })).toBe(true)
    expect(fails({ smoke: { budgetMs: 1, warmupMs: null, profileStopMs: null } })).toBe(true)
    expect(fails({ stage1: { ...PHASE2C26B2C2B2J_STAGE1, budgetMs: 3_600_000 } })).toBe(true)
    expect(fails({ stage1: { ...PHASE2C26B2C2B2J_STAGE1, childHeapMb: 16_384 } })).toBe(true)
    expect(fails({ cpuProfilerConfig: { ...PHASE2C26B2C2B2J_CPU_PROFILER, warmupMs: 60_000 } })).toBe(true)
    expect(fails({ changedFromB2C2B2I: [] })).toBe(true)
    expect(fails({ optimization: { id: 'other' } })).toBe(true)
    expect(fails({ baseMain: { pullRequest: 208, sha: 'f'.repeat(40) } })).toBe(true)
    expect(fails({ extra: true })).toBe(true)
    expect(fails({ attestedBy: 'analyzer' })).toBe(true)
    expect(verifyPhase2C26B2C2B2JStartAttestation(null, expectation).verified).toBe(false)
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2J isolation and provenance', () => {
  it('is never imported by Production, adds no Production seam, and hard-codes no Target, task, rank, extent or digest value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2J|reservedKeepFamilyLayoutKeyReuse/.test(source)).map(([path]) => path)).toEqual([])
    expect(bonusStreamSource).not.toMatch(/observeFamilyLayout|onFamilyLayoutKey|export (const|function) reservedGeneratedState/)
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|a367c177|4a875aac/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(1083|1084)\b/)
      expect(source).not.toMatch(/0\.0785|7\.86/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps every RESULT and every B2-C2B2I measurement out of the Search child: only the parent reads the B2-C2B2I RESULT, to attest SHA-256s', () => {
    const child = runnerSource.slice(runnerSource.indexOf("if (role !== 'parent') {"), runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    const parent = runnerSource.slice(runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    expect(child.length).toBeGreaterThan(1000)
    expect(child).not.toMatch(/b2c2b2i-result|b2c2b2i-raw|b2c2b2i-run-dir|rawB2C2B2I|Targets\.ts|parsePhase2C26B2C2B2JB2C2B2IAuthority|keepFamilyLayoutKeyShare|beforeFiles/)
    expect(child).toMatch(/j\.runPhase2C26B2C2B2JTask\(input, schedule, task, engine, \{ yieldControl, instrumentation: profiler\.instrumentation \}\)/)
    expect(child).toMatch(/new Session\(\)/)
    const childArgs = /const childArgs = \[([\s\S]*?)\]\n/.exec(parent)?.[1] ?? ''
    expect(childArgs).toMatch(/--role/)
    expect(childArgs).not.toMatch(/b2c2b2i|RESULT|before/i)
    expect(parent).toMatch(/--b2c2b2i-result/)
    expect(parent).toMatch(/phase2c26b2c2b2jOptimizationSourceCheck\(gitShow\(/)
    expect(parent).toMatch(/merge-base', '--is-ancestor', baseMain, 'HEAD'/)
    expect(parent).toMatch(/no formal run/)
    expect(runnerSource).not.toMatch(/--cpu-prof|--no-turbo-inlining|--no-maglev-inlining|--inspect|HeapProfiler|takeHeapSnapshot|startSampling/)
    expect(prepareSource).toMatch(/--b2c2b2i-result/)
    expect(prepareSource).not.toMatch(/--oracle|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).not.toMatch(/--oracle|ORACLE_[1]657|PHASE2C26A5_RESULT|PHASE2C26A8_RESULT|PHASE2C26A9_RESULT/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DFGHIJ]Search\(|runPhase2C26B2C2B2[DFGHIJ]Task\(/)
    expect(searchSource).not.toMatch(/Date\.now|performance\.now/)
  })
})

// ---------------------------------------------------------------- the committed formal RESULT

describe('Phase 2-C2.6-B2-C2B2J committed RESULT', () => {
  const result = JSON.parse(rawResult)
  const MEASURED_HEAD = '4ed9fb9ff93490f04178c50844b9eb5e2e95fb8e'
  const after = (category: string) => result.profiles.after.categories.find((c: { category: string }) => c.category === category)

  it('is formal: runner start attestation verified against the independently obtained HEAD / code / Export / manifest / B2-C2B2I (and its before files) / B2-C2B2H / G / F / E, no invalid reason', () => {
    expect(result.provenance).toMatchObject({ formal: true, evidenceGrade: 'formal', partialRun: false, launchProvenanceVerified: true, launchProvenanceSource: 'runner_start_attestation',
      launchProvenanceIssues: [], launchProvenanceIntegrityIssues: [], measuredHead: MEASURED_HEAD, measuredHeadIsAncestor: true, uncommittedBenchmarkCode: false,
      smoke: null, calculationCodeChangedSinceMeasuredHead: [], b2c2b2iResultSha256: reg.resultSha256, b2c2b2iMeasuredHead: reg.measuredHead, b2c2b2hResultSha256: reg.b2c2b2hResultSha256,
      b2c2b2gResultSha256: reg.b2c2b2gResultSha256, b2c2b2fResultSha256: reg.b2c2b2fResultSha256, b2c2b2eResultSha256: reg.b2c2b2eResultSha256, exportSha256: iJson.provenance.exportSha256,
      optimization: true, productionOptimizationId: PHASE2C26B2C2B2J_OPTIMIZATION.id, baseMain: PHASE2C26B2C2B2J_BASE_MAIN, routeExactJudged: false, oracleReadBySearchChild: false })
    expect(result.provenance.benchmarkCodeSha256).toBe(result.provenance.recomputedBenchmarkCodeSha256)
    expect(result.provenance.startAttestation.body).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2J_START_ATTESTATION_PHASE, repositoryHead: MEASURED_HEAD, smoke: null,
      uncommittedBenchmarkCode: false, baseMainIsAncestor: true, stage1: PHASE2C26B2C2B2J_STAGE1, cpuProfilerConfig: PHASE2C26B2C2B2J_CPU_PROFILER,
      productionChangedFiles: ['src/domain/search/bonusStream.ts'], productionChangedB2C2B2IToBaseMain: [], optimizationSourceCheckValid: true, b2c2b2iResultSha256: reg.resultSha256,
      b2c2b2iExcludedRouteKeySha256: iJson.parity.excludedRoute.rederivedExcludedRouteKeySha256, changedFromB2C2B2I: [...PHASE2C26B2C2B2J_CHANGED_FROM_B2C2B2I] })
    expect(result.provenance.startAttestation.body.createdAt).toBe(result.provenance.measuredAt)
    expect(result.invalidReasons).toEqual([])
    expect(result.afterProfileQualityIssues).toEqual([])
    expect(Object.values(result.parity.hashChain).every(v => v === true)).toBe(true)
    expect(Object.keys(result.parity.hashChain)).toHaveLength(31)
    expect(Object.values(result.conditions.conditionChecks).every(v => v === true)).toBe(true)
    // The before evidence: every local B2-C2B2I raw file is the one the B2-C2B2I RESULT recorded.
    for (const name of PHASE2C26B2C2B2J_BEFORE_FILES) expect(result.sources.b2c2b2iBefore[name]).toMatchObject({ recordedSha256: iJson.sources[name].sha256, localSha256: iJson.sources[name].sha256, matches: true })
    expect(result.provenance.startAttestation.body.b2c2b2iBeforeFiles).toEqual(Object.fromEntries(PHASE2C26B2C2B2J_BEFORE_FILES.map(name => [name, iJson.sources[name].sha256])))
  })

  it('changed exactly the registered Production source (none between B2-C2B2I\'s measured HEAD and the PR #209 main), in the registered shape, and searched B2-C2B2I\'s Target in B2-C2B2I\'s Search input', () => {
    expect(result.productionChange).toMatchObject({ beforeHead: reg.measuredHead, afterHead: MEASURED_HEAD, baseMain: PHASE2C26B2C2B2J_BASE_MAIN.sha, baseMainIsAncestorOfMeasuredHead: true,
      productionChangedB2C2B2IToBaseMain: [], productionChangedBaseMainToMeasuredHead: ['src/domain/search/bonusStream.ts'], productionChangedFiles: ['src/domain/search/bonusStream.ts'],
      equalsRegistered: true, equalsRunnerAttested: true, sourceCheck: { valid: true, onlyRegisteredRegionsChanged: true, afterReservedGeneratedStateComputesNoKey: true,
        afterResetCallComputesKeyFromResult: true, afterKeepCallPassesParentKey: true, predictKeepUnchanged: true, frontierReductionKeyUnchanged: true, resetMemoUnchanged: true } })
    const derived = phase2c26b2c2b2jPopulation(authorityI(), parsedH.authority, parsedG.authority, parsedF.authority, parsedE.authority)
    expect(result.population.targetWeaponIds).toEqual(derived.targetWeaponIds)
    expect(result.population.probes).toEqual(iJson.population.probes)
    expect(result.parity.population).toMatchObject({ manifestEqualsDerived: true, runnerTargetsEqualManifest: true, runnerProbesEqualManifest: true, runnerIdentitiesEqualManifest: true,
      probesEqualB2C2B2IProfiled: true, identitiesEqualB2C2B2IProfiled: true, targets: 1 })
    expect(result.parity.identity).toMatchObject({ rawEqualsExpected: true, expected: iJson.parity.identity.expected })
    expect(result.parity.taskRebuild).toMatchObject({ valid: true, tasksEqualRebuilt: true })
    expect(Object.values(result.parity.childIdentity).every(v => v === true)).toBe(true)
    const route = result.parity.excludedRoute
    expect([route.childAttestedExcludedRouteKeySha256, route.b2c2b2iExcludedRouteKeySha256]).toEqual([route.rederivedExcludedRouteKeySha256, route.rederivedExcludedRouteKeySha256])
    expect(route.rederivedExcludedRouteKeySha256).toBe(iJson.parity.excludedRoute.rederivedExcludedRouteKeySha256)
    // The PR #209 contract-valid fixtures and frozen records were not changed for this phase.
    expect(result.semanticParity.committedRegressionTests.fixturesChangedSinceBaseMain).toEqual([])
    expect(Object.values(result.semanticParity.committedRegressionTests.files).every(v => typeof v === 'string')).toBe(true)
  })

  it('pins semantic parity and the direct comparison: 480 identical common held-aware depths, state_generation 811.9 s -> 463.9 s (ratio 0.571)', () => {
    expect(result.semanticParity).toMatchObject({ valid: true, searchInputAndExcludedRoute: { valid: true } })
    const d = result.directComparison
    expect(d).toMatchObject({ valid: true, issues: [], semanticParity: true, beforeDepths: 480, afterDepths: 624, commonDepths: 480, firstMismatch: null, commonGeneratedStates: 842_597_754 })
    // The before run is B2-C2B2I's after run: the same depth count and generated states as the B2-C2B2I RESULT recorded.
    expect(d.beforeDepths).toBe(iJson.directComparison.afterDepths)
    expect(d.commonGeneratedStates).toBe(iJson.outcome.generatedStates)
    expect(d.stateGenerationDirectRatio).toBeCloseTo(d.afterStateGenerationMs / d.beforeStateGenerationMs, 12)
    expect(d.stateGenerationDirectRatio).toBeGreaterThan(0.57)
    expect(d.stateGenerationDirectRatio).toBeLessThan(0.58)
    expect(d.byThird.every((t: { ratio: number }) => t.ratio < PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO)).toBe(true)
  })

  it('pins the target function: keepFamilyLayoutKey registered inclusive 7.857 % -> 0.020 % of active CPU (ratio 0.0025), reproduced from the B2-C2B2I after profile', () => {
    const cpu = result.cpuTarget
    const recorded = iJson.profiles.after.registeredInclusive.find((r: { registered: string }) => r.registered === PHASE2C26B2C2B2J_TARGET_FUNCTION).shareOfActive
    expect(cpu).toMatchObject({ targetFunction: PHASE2C26B2C2B2J_TARGET_FUNCTION, beforeRecordedShare: recorded, beforeReproduced: true, beforeProfileValid: true, afterProfileValid: true })
    expect(cpu.beforeRecomputedShare).toBe(cpu.beforeRecordedShare)
    expect(cpu.keepFamilyLayoutKeyShareRatio).toBeCloseTo(cpu.afterShare / cpu.beforeRecordedShare, 12)
    expect(cpu.keepFamilyLayoutKeyShareRatio).toBeLessThan(0.01)
    // Not 0: the Reset path still computes the key.
    expect(cpu.afterShare).toBeGreaterThan(0)
    expect(result.profiles.after.samples).toEqual({ all: 58_032, interval: 21_121, idle: 900, active: 20_221 })
    expect(result.profiles.after).toMatchObject({ valid: true, registeredLineMismatches: [], clockAlignment: { valid: true, negativeTimeDeltas: 0 }, window: { stoppedBy: 'window', error: null } })
    expect(result.profiles.after.unattributedActiveShare).toBeLessThan(0.5)
    expect(after('state_construction_family_layout').samples).toBe(184)
    expect(result.profiles.after.reservedGeneratedStateLineTicks.inSpan.map((l: { text: string }) => l.text).join('\n')).not.toMatch(/keepFamilyLayoutKey\(/)
    expect(result.gc).toMatchObject({ before: { samples: 5_991 }, after: { samples: 4_079 } })
  })

  it('pins the pre-registered decision: ADOPTED, recomputed from the recorded comparisons', () => {
    expect(result.thresholds).toEqual({ adoptMaxKeyShareRatio: 0.5, adoptMaxDirectRatio: 0.95, regressionDirectRatio: 1.05, noEffectKeyShareRatio: 0.9, noEffectDirectRatio: 0.98 })
    expect(result.decision).toMatchObject({ case: 'B2C2B2J_ADOPTED', adoption: 'adopt', reasons: [], stateGenerationDirectRatio: result.directComparison.stateGenerationDirectRatio,
      keepFamilyLayoutKeyShareRatio: result.cpuTarget.keepFamilyLayoutKeyShareRatio })
    expect(phase2c26b2c2b2jDecision({ invalidReasons: [], identityParity: true, direct: result.directComparison, cpu: result.cpuTarget }).case).toBe('B2C2B2J_ADOPTED')
    expect(result.outcome).toMatchObject({ process: 'timeout', record: null, naturalCompletion: false, budgetMs: 1_800_000, completedDepths: 624, deliveredBeforeKill: { deliveryFlushes: 0, deliveryConsumerCalls: 0 } })
    expect(result.memory.heapRatio).toBeLessThan(1.05)
  })
})
