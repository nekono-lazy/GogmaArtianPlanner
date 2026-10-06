import { describe, expect, it } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawB2C2B2F from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json?raw'
import rawB2C2B2G from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json?raw'
import rawB2C2B2H from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2H_RESULT.json?raw'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json?raw'
import rawFrozen from '../test/fixtures/predictKeepCachePreB2I.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimeEvent } from '../domain/search/bonusStream'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import { parsePhase2C26B2C2B2FB2C2B2EAuthority, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E } from './plannerGlobalPhase2C26B2C2B2FTargets'
import type { Phase2C26B2C2B2GProfileSnapshot } from './plannerGlobalPhase2C26B2C2B2G'
import { parsePhase2C26B2C2B2GB2C2B2FAuthority, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F } from './plannerGlobalPhase2C26B2C2B2GTargets'
import {
  buildPhase2C26B2C2B2HTasks,
  createPhase2C26B2C2B2HProfiler,
  phase2c26b2c2b2hRegisteredConditions,
  runPhase2C26B2C2B2HTask,
  PHASE2C26B2C2B2H_CPU_PROFILER,
  PHASE2C26B2C2B2H_STAGE1,
} from './plannerGlobalPhase2C26B2C2B2H'
import { parsePhase2C26B2C2B2HB2C2B2GAuthority, phase2c26b2c2b2hPopulation, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G } from './plannerGlobalPhase2C26B2C2B2HTargets'
import type { Phase2C26B2C2B2HProfileAnalysis } from './plannerGlobalPhase2C26B2C2B2HAnalysis'
import {
  buildPhase2C26B2C2B2ITasks,
  createPhase2C26B2C2B2IProfiler,
  isPhase2C26B2C2B2IResearchOrTestPath,
  parsePhase2C26B2C2B2IProbeManifest,
  phase2c26b2c2b2iNormalizeOptimizedRegions,
  phase2c26b2c2b2iOptimizationSourceCheck,
  phase2c26b2c2b2iProductionChangedFiles,
  phase2c26b2c2b2iRegisteredConditions,
  phase2c26b2c2b2iStartAttestationBody,
  runPhase2C26B2C2B2ITask,
  verifyPhase2C26B2C2B2IStartAttestation,
  PHASE2C26B2C2B2I_BEFORE_FILES,
  PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H,
  PHASE2C26B2C2B2I_CPU_PROFILER,
  PHASE2C26B2C2B2I_EXPECTED_TASKS,
  PHASE2C26B2C2B2I_NOT_RUN,
  PHASE2C26B2C2B2I_OPTIMIZATION,
  PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES,
  PHASE2C26B2C2B2I_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2I_STAGE1,
  PHASE2C26B2C2B2I_START_ATTESTATION_PHASE,
  type Phase2C26B2C2B2IAttestationExpectation,
  type Phase2C26B2C2B2IBeforeFile,
} from './plannerGlobalPhase2C26B2C2B2I'
import searchSource from './plannerGlobalPhase2C26B2C2B2I.ts?raw'
import {
  parsePhase2C26B2C2B2IB2C2B2HAuthority,
  phase2c26b2c2b2iPopulation,
  phase2c26b2c2b2iProbeManifest,
  PHASE2C26B2C2B2I_REGISTERED_B2C2B2H,
} from './plannerGlobalPhase2C26B2C2B2ITargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2ITargets.ts?raw'
import {
  phase2c26b2c2b2iCpuComparison,
  phase2c26b2c2b2iDecision,
  phase2c26b2c2b2iDirectComparison,
  phase2c26b2c2b2iMemory,
  PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO,
  PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO,
  PHASE2C26B2C2B2I_DECISION_CASES,
  PHASE2C26B2C2B2I_NO_EFFECT_RATIO,
  PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO,
  type Phase2C26B2C2B2ICpuComparison,
  type Phase2C26B2C2B2IDirectComparison,
} from './plannerGlobalPhase2C26B2C2B2IAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2IAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2i-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2i.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2i.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2I: the predictKeep nested (counter, family layout) memo and its formal before / after check against
 * B2-C2B2H. The committed B2-C2B2H / B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs are read only to check the authorities and the population
 * derivation; the synthetic snapshots and analyses below are invented for the tests. No oracle module is imported here. The stream /
 * Search semantics of the optimization itself is fixed by src/domain/search/predictKeepNestedCache.test.ts (frozen pre-optimization
 * records), reservedBonusStreamSinglePass.test.ts and bonusStreamIndependence.test.ts.
 */

type Json = Record<string, unknown>
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
const hJson = JSON.parse(rawB2C2B2H)
const gJson = JSON.parse(rawB2C2B2G)
const parsedG = parsePhase2C26B2C2B2HB2C2B2GAuthority(gJson, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256)
const parsedF = parsePhase2C26B2C2B2GB2C2B2FAuthority(JSON.parse(rawB2C2B2F), PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
const parsedE = parsePhase2C26B2C2B2FB2C2B2EAuthority(JSON.parse(rawB2C2B2E), PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
const hWith = (patch: (j: Json & { decision: Json; provenance: Json; parity: Json; population: Json; conditions: Json; sources: Json; cpuAttribution: Json }) => void) => {
  const copy = structuredClone(hJson)
  patch(copy)
  return parsePhase2C26B2C2B2IB2C2B2HAuthority(copy, PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256)
}
const authorityH = () => parsePhase2C26B2C2B2IB2C2B2HAuthority(hJson, PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256).authority!

// ---------------------------------------------------------------- the before authority, the chain and the population

describe('Phase 2-C2.6-B2-C2B2I before authority, population and manifest', () => {
  it('reads the committed B2-C2B2H RESULT as the registered formal before authority, failing closed on another SHA-256, case, next phase, share, profile, condition, chain, identity or file record', async () => {
    expect(await sha256(rawB2C2B2H)).toBe(PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256)
    expect(await sha256(rawB2C2B2G)).toBe(PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2gResultSha256)
    expect(await sha256(rawB2C2B2F)).toBe(PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2fResultSha256)
    expect(await sha256(rawB2C2B2E)).toBe(PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2eResultSha256)
    const parsed = parsePhase2C26B2C2B2IB2C2B2HAuthority(hJson, PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2H_MIXED', nextPhaseCategories: ['keep_prediction'], measuredHead: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.measuredHead,
      keepPredictionShareOfActive: hJson.decision.secondary[0].shareOfActive, b2c2b2gResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256 })
    expect(parsed.authority!.keepPredictionShareOfActive).toBeGreaterThanOrEqual(0.2)
    // Every before raw file is the one the RESULT recorded (the runner and the analyzer compare the local files with these).
    for (const name of PHASE2C26B2C2B2I_BEFORE_FILES) expect(parsed.authority!.beforeFiles[name]).toEqual({ file: hJson.sources[name].file, sha256: hJson.sources[name].sha256 })
    expect(parsed.authority!.predictKeepLineTicks.map(l => l.text)).toContain('const cached = keepPredictions.get(key)')
    expect(parsePhase2C26B2C2B2IB2C2B2HAuthority(hJson, '0'.repeat(64)).valid).toBe(false)
    expect(hWith(j => { j.decision.case = 'B2C2B2H_KEEP_PREDICTION_DOMINANT' }).valid).toBe(false)
    expect(hWith(j => { j.decision.nextPhaseCategories = ['keep_prediction', 'gc'] }).valid).toBe(false)
    expect(hWith(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(hWith(j => { j.provenance.evidenceGrade = 'non_formal' }).valid).toBe(false)
    expect(hWith(j => { j.provenance.partialRun = true }).valid).toBe(false)
    expect(hWith(j => { j.provenance.measuredHead = 'f'.repeat(40) }).valid).toBe(false)
    expect(hWith(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(hWith(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(hWith(j => { (j as Json).insufficientReasons = ['short profile'] }).valid).toBe(false)
    expect(hWith(j => { ((j.cpuAttribution.categories as Json[]).find(c => c.category === 'keep_prediction') as Json).shareOfActive = 0.19 }).valid).toBe(false)
    expect(hWith(j => { j.cpuAttribution.registeredLineMismatches = ['x'] }).valid).toBe(false)
    expect(hWith(j => { j.conditions.stage1 = { ...PHASE2C26B2C2B2H_STAGE1, budgetMs: 3_600_000 } }).valid).toBe(false)
    expect(hWith(j => { j.conditions.cpuProfilerConfig = { ...PHASE2C26B2C2B2H_CPU_PROFILER, warmupMs: 60_000 } }).valid).toBe(false)
    expect(hWith(j => { j.conditions.nodeFlags = ['--max-old-space-size=16384'] }).valid).toBe(false)
    expect(hWith(j => { (j.parity.hashChain as Json).exportMatchesRunner = false }).valid).toBe(false)
    expect(hWith(j => { (j.parity.childIdentity as Json).searchInputDigest = false }).valid).toBe(false)
    expect(hWith(j => { (j.parity.semanticParityWithB2C2B2G as Json).valid = false }).valid).toBe(false)
    expect(hWith(j => { (j.parity.excludedRoute as Json).childAttestedExcludedRouteKeySha256 = '2'.repeat(64) }).valid).toBe(false)
    expect(hWith(j => { j.provenance.b2c2b2gResultSha256 = '1'.repeat(64) }).valid).toBe(false)
    expect(hWith(j => { j.population.probes = [] }).valid).toBe(false)
    expect(hWith(j => { j.sources.cpuProfile = null }).valid).toBe(false)
    expect(hWith(j => { (j.sources.sections as Json).sha256 = 'x' }).valid).toBe(false)
  })

  it('derives the population mechanically from B2-C2B2H (1 Target) and chains it to the B2-C2B2H-derived (B2-C2B2G / B2-C2B2F / B2-C2B2E) probe, identity and excluded Route; never a hard-coded Target', () => {
    const h = authorityH()
    const derived = phase2c26b2c2b2iPopulation(h, parsedG.authority, parsedF.authority, parsedE.authority)
    expect(derived.issues).toEqual([])
    expect(Object.values(derived.chain).every(v => v === true)).toBe(true)
    expect(derived.targetWeaponIds).toEqual(hJson.population.targetWeaponIds)
    expect(derived.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2I_EXPECTED_TASKS)
    expect(derived.probes).toEqual(hJson.population.probes)
    expect(derived.expectedTaskIdentities).toEqual([hJson.parity.identity.expected])
    const fromH = phase2c26b2c2b2hPopulation(parsedG.authority, parsedF.authority, parsedE.authority)
    expect(derived.probes).toEqual(fromH.probes)
    expect(derived.expectedTaskIdentities).toEqual(fromH.expectedTaskIdentities)
    expect(derived.excludedRouteKeySha256).toBe(fromH.excludedRouteKeySha256)
    expect(derived.excludedRouteKeySha256).toBe(hJson.parity.excludedRoute.rederivedExcludedRouteKeySha256)
    // Fail closed: a drifting probe / identity / excluded Route / Export / chain, a missing authority, another decision.
    expect(phase2c26b2c2b2iPopulation({ ...h, probes: [{ ...h.probes[0]!, contextRank: h.probes[0]!.contextRank + 1 }] }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/probesEqualB2C2B2HDerived/)
    expect(phase2c26b2c2b2iPopulation({ ...h, expectedTaskIdentities: [{ ...h.expectedTaskIdentities[0]!, searchInputDigest: 'x' }] }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/identitiesEqualB2C2B2HDerived/)
    expect(phase2c26b2c2b2iPopulation({ ...h, excludedRouteKeySha256: '3'.repeat(64) }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/excludedRouteEqualsB2C2B2HDerived/)
    expect(phase2c26b2c2b2iPopulation({ ...h, exportSha256: '4'.repeat(64) }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/exportEqualsB2C2B2G/)
    expect(phase2c26b2c2b2iPopulation({ ...h, b2c2b2gResultSha256: '5'.repeat(64) }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/b2c2b2gAuthorityIsB2C2B2HAuthority/)
    expect(phase2c26b2c2b2iPopulation({ ...h, b2c2b2eResultSha256: '6'.repeat(64) }, parsedG.authority, parsedF.authority, parsedE.authority).issues.join()).toMatch(/b2c2b2eAuthorityIsB2C2B2HAuthority/)
    expect(phase2c26b2c2b2iPopulation({ ...h, decisionCase: 'B2C2B2H_GC_DOMINANT' }, parsedG.authority, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2iPopulation({ ...h, targetWeaponIds: [] }, parsedG.authority, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2iPopulation(null, parsedG.authority, parsedF.authority, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
    expect(phase2c26b2c2b2iPopulation(h, null, parsedF.authority, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('writes the probe and its expected Search input identity only (B2-C2B2H\'s Search input), exactly what the runner accepts', () => {
    const manifest = phase2c26b2c2b2iProbeManifest(authorityH(), parsedG.authority!, parsedF.authority!, parsedE.authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'b2c2b2hResultSha256', 'contextSelection', 'expectedTaskIdentities',
      'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ b2c2b2hResultSha256: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256, population: 'B2C2B2H_KEEP_PREDICTION_PROFILED_TARGET', exportSha256: hJson.provenance.exportSha256 })
    // The same Search input as B2-C2B2H: its attested probe and expected identity.
    expect(manifest.probes).toEqual(hJson.provenance.startAttestation.body.probes)
    expect(manifest.expectedTaskIdentities).toEqual(hJson.provenance.startAttestation.body.expectedTaskIdentities)
    expect(JSON.stringify(manifest.probes) + JSON.stringify(manifest.expectedTaskIdentities)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|oracle|timeout|memory|heap|yield|wall|section|dominant|state_generation|hotspot|sample|category|keep_prediction/i)
    expect(parsePhase2C26B2C2B2IProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2IProbeManifest(copy).valid }
    expect(bad(m => { m.probes = [] })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.contextRank += 1 })).toBe(false)
    expect(bad(m => { (m as Json).population = 'B2C2B2G_STATE_GENERATION_DOMINANT_PROFILED_TARGET' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2hResultSha256 = 'x' })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedHotspot', 'b2c2b2hStateGenerationMs', 'keepPredictionShare']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- the registered optimization and the Production change

const NEW_DECLARATION = '  /** Keep memo: Gogma Counter -> ordered family layout key -> prediction. */\n  const keepPredictions = new Map<number, Map<string, RestorationBonusSet>>()'
const OLD_DECLARATION = '  const keepPredictions = new Map<string, RestorationBonusSet>()'
const OLD_PREDICT_KEEP = [
  '  /**',
  '   * Keep depends on the current slots only through their families, so states',
  '   * that share a layout share this prediction. The representative\'s five slots',
  '   * are the explicit Engine input; a tier difference never adds a call.',
  '   */',
  '  function predictKeep(',
  '    gogmaCounter: number,',
  '    familyLayoutKey: string,',
  '    currentBonuses: RestorationBonusSet,',
  '  ): RestorationBonusSet {',
  '    const key = `${gogmaCounter}\\u0000${familyLayoutKey}`',
  '    const cached = keepPredictions.get(key)',
  '    if (cached) return cached',
  '    const predicted = engine.predictGogmaBonus({',
  '      baseSeed: input.rngState.baseSeed.value as string,',
  '      gogmaCounter,',
  '      weaponTypeId: target.weaponTypeId,',
  '      elementId: target.elementId,',
  '      operation: { type: \'keep_bonuses\', currentBonuses },',
  '      master: input.master,',
  '    })',
  '    keepPredictions.set(key, predicted)',
  '    return predicted',
  '  }',
].join('\n')
/** The current predictKeep() with its JSDoc, cut from the source. */
const currentPredictKeep = () => {
  const lines = bonusStreamSource.split('\n')
  const fn = lines.findIndex(l => l === '  function predictKeep(')
  let start = fn - 1
  while (lines[start]!.trim() !== '/**') start -= 1
  const end = lines.findIndex((l, i) => i > fn && l === '  }')
  return lines.slice(start, end + 1).join('\n')
}
/** bonusStream.ts as it was before the optimization (the old memo restored into the current text). */
const beforeSource = () => bonusStreamSource.replace(NEW_DECLARATION, OLD_DECLARATION).replace(currentPredictKeep(), OLD_PREDICT_KEEP)

describe('Phase 2-C2.6-B2-C2B2I registered optimization and Production change', () => {
  it('registers exactly one optimization of one Production file, with B2-C2B2H\'s conditions otherwise unchanged', () => {
    expect(PHASE2C26B2C2B2I_OPTIMIZATION.id).toBe('predict_keep_nested_counter_family_cache_v1')
    expect(PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES).toEqual(['src/domain/search/bonusStream.ts'])
    expect(PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H).toEqual(['production_optimization:predict_keep_nested_counter_family_cache_v1'])
    expect(PHASE2C26B2C2B2I_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2I_STAGE1).toEqual(PHASE2C26B2C2B2H_STAGE1)
    expect(PHASE2C26B2C2B2I_CPU_PROFILER).toEqual({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 })
    expect(phase2c26b2c2b2iRegisteredConditions().b2c2b2hConditions).toEqual(phase2c26b2c2b2hRegisteredConditions())
    expect(phase2c26b2c2b2hRegisteredConditions()).toMatchObject({ nodeFlags: ['--max-old-space-size=12288'], searchInstrumentation: { onSearchRuntime: true, onGogmaReservedRuntime: true,
      onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false }, nodeYield: 'setImmediate', memorySampleIntervalMs: 250, heartbeatIntervalMs: 5_000 })
    expect(PHASE2C26B2C2B2I_PROVENANCE_FLAGS).toMatchObject({ optimization: true, productionOptimizationId: PHASE2C26B2C2B2I_OPTIMIZATION.id, oracleReadBySearchChild: false,
      expectedOutcomeKnownBySearchChild: false, routeExactJudged: false, cpuProfiling: true })
    for (const notRun of ['second_production_optimization', 'frontier_reduction_key_change', 'keep_family_layout_key_optimization', 'reserved_generated_state_optimization',
      'solution_materialization_optimization', 'checkpoint_or_yield_change', 'reset_memo_change', 'extent_change', 'context_change', 'p1_change', 'no_inlining_diagnostic',
      'heap_allocation_profiler', 'heap_snapshot', 'heap_16gb', 'budget_60min_or_more', 'retry', 'timeout_fallback', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support',
      'global_assignment', 'full_planner_rerun', 'ui_change', 'b2c2b2h_rerun']) expect(PHASE2C26B2C2B2I_NOT_RUN).toContain(notRun)
    expect(PHASE2C26B2C2B2I_NOT_RUN).not.toContain('production_optimization')
  })

  it('counts only Production calculation sources as a Production change', () => {
    expect(phase2c26b2c2b2iProductionChangedFiles(['src/domain/search/bonusStream.ts', 'src/benchmarks/plannerGlobalPhase2C26B2C2B2I.ts', 'scripts/run-planner-global-phase2c26b2c2b2i.mjs',
      'src/domain/search/predictKeepNestedCache.test.ts', 'src/test/fixtures/predictKeepCachePreB2I.json', 'docs/x.md', ''])).toEqual(['src/domain/search/bonusStream.ts'])
    expect(phase2c26b2c2b2iProductionChangedFiles(['src/domain/search/bonusStream.ts', 'src/domain/rng/gogmaBonusFamily.ts'])).toEqual(['src/domain/rng/gogmaBonusFamily.ts', 'src/domain/search/bonusStream.ts'])
    expect(phase2c26b2c2b2iProductionChangedFiles(['package.json'])).toEqual(['package.json'])
    for (const path of ['src/benchmarks/a.ts', 'src/test/fixtures/b.ts', 'src/domain/c.test.ts', 'scripts/d.mjs', 'docs/e.md']) expect(isPhase2C26B2C2B2IResearchOrTestPath(path)).toBe(true)
    for (const path of ['src/domain/search/bonusStream.ts', 'src/services/x.ts', 'vite.config.ts']) expect(isPhase2C26B2C2B2IResearchOrTestPath(path)).toBe(false)
  })

  it('accepts exactly the registered predictKeep change: identical outside the memo declaration and predictKeep(), no composite key, nested lookup, registration after the prediction, frontier key and Reset memo untouched', () => {
    const before = beforeSource()
    expect(before).not.toBe(bonusStreamSource)
    expect(before).toContain('const key = `${gogmaCounter}\\u0000${familyLayoutKey}`')
    const check = phase2c26b2c2b2iOptimizationSourceCheck(before, bonusStreamSource)
    expect(check).toEqual({ valid: true, issues: [], onlyRegisteredRegionsChanged: true, beforeHasCompositeKey: true, afterHasCompositeKey: false, afterHasNestedLookup: true,
      afterDeclaresNestedMemo: true, frontierReductionKeyUnchanged: true, resetMemoUnchanged: true, afterRegistersOnlyAfterPrediction: true })
    // CRLF is the same text.
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before.replace(/\n/g, '\r\n'), bonusStreamSource).valid).toBe(true)
    // Fail closed: a change outside the regions, the frontier reduction key, the Reset memo, a composite key, a write before the prediction, no change at all.
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, bonusStreamSource.replace('const resetSupport = predictionSupport.gogmaReset()', 'const resetSupport = predictionSupport.gogmaReset() ')).issues).toContain('source check: onlyRegisteredRegionsChanged')
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, bonusStreamSource.replace('const key = `${state.position}\\u0000${state.familyLayoutKey}`', 'const key = `${state.position}|${state.familyLayoutKey}`')).issues)
      .toEqual(expect.arrayContaining(['source check: onlyRegisteredRegionsChanged', 'source check: frontierReductionKeyUnchanged']))
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, bonusStreamSource.replace('const resetPredictions = new Map<number, RestorationBonusSet>()', 'const resetPredictions = new Map<string, RestorationBonusSet>()')).valid).toBe(false)
    const composite = bonusStreamSource.replace('const cached = byFamilyLayout?.get(familyLayoutKey)', 'const cached = byFamilyLayout?.get(`${gogmaCounter}\\u0000${familyLayoutKey}`)')
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, composite).issues).toContain('source check: predictKeep() still builds a composite key')
    const early = bonusStreamSource.replace('    const byFamilyLayout = keepPredictions.get(gogmaCounter)\n', '    const byFamilyLayout = keepPredictions.get(gogmaCounter) ?? new Map()\n    keepPredictions.set(gogmaCounter, byFamilyLayout)\n')
    expect(early).not.toBe(bonusStreamSource)
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, early).issues).toContain('source check: afterRegistersOnlyAfterPrediction')
    expect(phase2c26b2c2b2iOptimizationSourceCheck(before, before).valid).toBe(false)
    expect(phase2c26b2c2b2iOptimizationSourceCheck(bonusStreamSource, bonusStreamSource).issues).toContain('source check: beforeHasCompositeKey')
    expect(phase2c26b2c2b2iNormalizeOptimizedRegions('no memo here')).toBeNull()
  })

  it('the current predictKeep() builds no composite key, and the frontier reduction composite key is unchanged', () => {
    const fn = currentPredictKeep()
    expect(fn).not.toMatch(/\\u0000|`\$\{gogmaCounter\}/)
    expect(fn).toMatch(/keepPredictions\.get\(gogmaCounter\)/)
    expect(bonusStreamSource.split('const key = `${state.position}\\u0000${state.familyLayoutKey}`').length).toBe(2)
  })
})

// ---------------------------------------------------------------- task construction and child calculation

describe('Phase 2-C2.6-B2-C2B2I task construction and child calculation', () => {
  it('is B2-C2B2H\'s (= B2-C2B2G\'s) child calculation and profiler, the same function objects', () => {
    expect(runPhase2C26B2C2B2ITask).toBe(runPhase2C26B2C2B2HTask)
    expect(createPhase2C26B2C2B2IProfiler).toBe(createPhase2C26B2C2B2HProfiler)
    expect(searchSource).toMatch(/const built = buildPhase2C26B2C2B2HTasks\(schedule, manifest\)/)
    expect(buildPhase2C26B2C2B2ITasks).toBeTypeOf('function')
    expect(buildPhase2C26B2C2B2HTasks).toBeTypeOf('function')
  })
})

// ---------------------------------------------------------------- the direct before / after comparison

const COUNTS = { frontierStatesBefore: 1, legalPositionCount: 2, generatedStates: null, frontierStatesAfter: 1, windowMemoEntries: 1 }
const ev = (type: ReservedGogmaRuntimeEvent['type'], depth: number, extra: object = {}): ReservedGogmaRuntimeEvent =>
  ({ type, streamIndex: 0, startGogmaCounter: 10, depth, counts: { ...COUNTS }, ...(type === 'depth_completed' ? { exhausted: false } : {}), ...extra }) as ReservedGogmaRuntimeEvent
/** One run's snapshots: each depth spends `stateGenerationMs` in state_generation and 1 ms in every other section. */
function run(depths: { generated: number; stateGenerationMs: number }[], options: { skipStateGeneration?: number } = {}) {
  let clock = 0
  const profiler = createPhase2C26B2C2B2IProfiler({ now: () => clock, emitBoundary: () => undefined })
  profiler.start()
  const o = (section: string, extra: object = {}) => profiler.outerObserver({ type: 'section_started', section, ...extra } as never)
  o('search_runtime'); o('scheduler_step'); o('scheduler_settle'); o('bonus_depth_work', { work: { channel: 0, depth: 1 } }); o('bonus_depth_read')
  depths.forEach((d, index) => {
    const depth = index + 1
    profiler.innerObserver(ev('depth_started', depth))
    for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) {
      if (phase === 'state_generation' && options.skipStateGeneration === index) continue
      profiler.innerObserver(ev('phase_started', depth, { phase }))
      clock += phase === 'state_generation' ? d.stateGenerationMs : 1
      profiler.innerObserver(ev('phase_completed', depth, { phase }))
    }
    profiler.innerObserver(ev('depth_completed', depth, { counts: { ...COUNTS, generatedStates: d.generated } }))
  })
  return [profiler.snapshot('heartbeat')] as Phase2C26B2C2B2GProfileSnapshot[]
}
const depths = (n: number, ms: number) => Array.from({ length: n }, (_, i) => ({ generated: 100 + i, stateGenerationMs: ms }))

describe('Phase 2-C2.6-B2-C2B2I direct comparison over the common held-aware depth prefix', () => {
  it('compares the same work: Σ state_generation ms of the semantic-identical common prefix, the after run may go further', () => {
    const c = phase2c26b2c2b2iDirectComparison(run(depths(6, 10)), run(depths(9, 7)))
    expect(c).toMatchObject({ valid: true, issues: [], semanticParity: true, beforeDepths: 6, afterDepths: 9, commonDepths: 6, firstMismatch: null,
      commonGeneratedStates: 615, beforeStateGenerationMs: 60, afterStateGenerationMs: 42 })
    expect(c.stateGenerationDirectRatio).toBeCloseTo(0.7, 12)
    expect(c.beforeNsPerGeneratedState).toBeCloseTo((60 * 1e6) / 615, 6)
    expect(c.byThird.map(t => [t.fromIndex, t.toIndex, t.beforeMs, t.afterMs])).toEqual([[0, 2, 20, 14], [2, 4, 20, 14], [4, 6, 20, 14]])
    expect(c.otherSections.every(s => s.ratio === 1)).toBe(true)
    expect(c.otherSections.map(s => s.section)).not.toContain('state_generation')
    // The before run going further compares the after run's depths.
    expect(phase2c26b2c2b2iDirectComparison(run(depths(5, 10)), run(depths(3, 10)))).toMatchObject({ commonDepths: 3, stateGenerationDirectRatio: 1 })
  })

  it('rejects semantic parity on the first differing depth (counts), never compares beyond it, and fails closed on no common depth or a missing section time', () => {
    const before = depths(4, 10)
    const after = depths(4, 5).map((d, i) => (i === 2 ? { ...d, generated: d.generated + 1 } : d))
    const c = phase2c26b2c2b2iDirectComparison(run(before), run(after))
    expect(c).toMatchObject({ semanticParity: false, commonDepths: 2, firstMismatch: { index: 2 }, valid: true, beforeStateGenerationMs: 20, afterStateGenerationMs: 10 })
    expect(phase2c26b2c2b2iDirectComparison([], run(depths(2, 1)))).toMatchObject({ valid: false, semanticParity: false, stateGenerationDirectRatio: null })
    const missing = phase2c26b2c2b2iDirectComparison(run(depths(3, 10)), run(depths(3, 10), { skipStateGeneration: 1 }))
    expect(missing.valid).toBe(false)
    expect(missing.issues.join()).toMatch(/without a state_generation section time/)
    expect(missing.stateGenerationDirectRatio).toBeNull()
  })
})

// ---------------------------------------------------------------- the CPU comparison and the decision

const analysisWith = (keep: number): Phase2C26B2C2B2HProfileAnalysis => ({ categories: [{ category: 'keep_prediction', samples: 1, shareOfActive: keep, shareOfInterval: keep },
  { category: 'program', samples: 1, shareOfActive: 0.3, shareOfInterval: 0.3 }], lineTicks: [] }) as unknown as Phase2C26B2C2B2HProfileAnalysis
const directWith = (ratio: number | null, patch: Partial<Phase2C26B2C2B2IDirectComparison> = {}): Phase2C26B2C2B2IDirectComparison => ({ valid: ratio !== null, issues: [], semanticParity: true,
  beforeDepths: 10, afterDepths: 12, commonDepths: 10, firstMismatch: null, commonGeneratedStates: 1000, beforeStateGenerationMs: 100, afterStateGenerationMs: ratio === null ? null : 100 * ratio,
  stateGenerationDirectRatio: ratio, beforeNsPerGeneratedState: null, afterNsPerGeneratedState: null, byThird: [], otherSections: [], inclusive: { beforeMs: 0, afterMs: 0, ratio: null }, ...patch })
const cpuWith = (keepRatio: number | null, patch: Partial<Phase2C26B2C2B2ICpuComparison> = {}): Phase2C26B2C2B2ICpuComparison => ({ beforeRecordedShare: 0.4, beforeRecomputedShare: 0.4,
  beforeReproduced: true, beforeProfileValid: true, beforeQualityIssues: [], afterShare: keepRatio === null ? null : 0.4 * keepRatio, afterProfileValid: keepRatio !== null, afterQualityIssues: [],
  keepPredictionShareRatio: keepRatio, descriptiveShareRatio: keepRatio, categories: [], ...patch })
const decide = (direct: Phase2C26B2C2B2IDirectComparison | null, cpu: Phase2C26B2C2B2ICpuComparison | null, invalid: string[] = [], identityParity = true) =>
  phase2c26b2c2b2iDecision({ invalidReasons: invalid, identityParity, direct, cpu })

describe('Phase 2-C2.6-B2-C2B2I CPU hotspot comparison and the pre-registered decision', () => {
  it('uses the after / before keep_prediction share only when both profiles pass the quality rule and the before re-analysis reproduces the RESULT', () => {
    const ok = phase2c26b2c2b2iCpuComparison({ beforeRecordedShare: 0.4, beforeAnalysis: analysisWith(0.4), beforeQualityIssues: [], afterAnalysis: analysisWith(0.1), afterQualityIssues: [] })
    expect(ok).toMatchObject({ beforeReproduced: true, beforeProfileValid: true, afterProfileValid: true, afterShare: 0.1, keepPredictionShareRatio: 0.25, descriptiveShareRatio: 0.25 })
    expect(ok.categories).toEqual([{ category: 'keep_prediction', beforeShareOfActive: 0.4, afterShareOfActive: 0.1 }, { category: 'program', beforeShareOfActive: 0.3, afterShareOfActive: 0.3 }])
    const short = phase2c26b2c2b2iCpuComparison({ beforeRecordedShare: 0.4, beforeAnalysis: analysisWith(0.4), beforeQualityIssues: [], afterAnalysis: analysisWith(0.1), afterQualityIssues: ['the profile spans 1 ms'] })
    expect(short).toMatchObject({ afterProfileValid: false, keepPredictionShareRatio: null, descriptiveShareRatio: 0.25 })
    const drift = phase2c26b2c2b2iCpuComparison({ beforeRecordedShare: 0.4, beforeAnalysis: analysisWith(0.41), beforeQualityIssues: [], afterAnalysis: analysisWith(0.1), afterQualityIssues: [] })
    expect(drift).toMatchObject({ beforeReproduced: false, beforeProfileValid: false, keepPredictionShareRatio: null })
  })

  it('fixes the thresholds 0.75 / 0.90 / 1.05 / 0.95 and the case order: INVALID, INSUFFICIENT, semantic mismatch, O, regression, no effect, P', () => {
    expect([PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO, PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO, PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO, PHASE2C26B2C2B2I_NO_EFFECT_RATIO]).toEqual([0.75, 0.9, 1.05, 0.95])
    expect(PHASE2C26B2C2B2I_DECISION_CASES).toEqual(['B2C2B2I_INVALID', 'B2C2B2I_INSUFFICIENT', 'B2C2B2I_REJECTED_SEMANTIC_MISMATCH', 'B2C2B2I_ADOPTED', 'B2C2B2I_REJECTED_REGRESSION',
      'B2C2B2I_REJECTED_NO_EFFECT', 'B2C2B2I_PARTIAL'])
    // O at both boundaries (inclusive), never past either.
    expect(decide(directWith(0.9), cpuWith(0.75))).toMatchObject({ case: 'B2C2B2I_ADOPTED', adoption: 'adopt', stateGenerationDirectRatio: 0.9, keepPredictionShareRatio: 0.75 })
    expect(decide(directWith(0.5), cpuWith(0.1)).case).toBe('B2C2B2I_ADOPTED')
    expect(decide(directWith(0.9000001), cpuWith(0.5)).case).toBe('B2C2B2I_PARTIAL')
    expect(decide(directWith(0.5), cpuWith(0.7500001)).case).toBe('B2C2B2I_PARTIAL')
    // O needs both profiles valid.
    expect(decide(directWith(0.5), cpuWith(0.1, { afterProfileValid: false })).case).toBe('B2C2B2I_PARTIAL')
    expect(decide(directWith(0.5), cpuWith(0.1, { beforeProfileValid: false })).case).toBe('B2C2B2I_PARTIAL')
    expect(decide(directWith(0.5), cpuWith(null))).toMatchObject({ case: 'B2C2B2I_PARTIAL', adoption: 'undecided' })
    // Regression: strictly above 1.05, whatever the CPU share.
    expect(decide(directWith(1.05), cpuWith(1)).case).toBe('B2C2B2I_REJECTED_NO_EFFECT')
    expect(decide(directWith(1.0500001), cpuWith(0.1))).toMatchObject({ case: 'B2C2B2I_REJECTED_REGRESSION', adoption: 'reject' })
    expect(decide(directWith(1.2), cpuWith(null)).case).toBe('B2C2B2I_REJECTED_REGRESSION')
    // No effect: both >= 0.95.
    expect(decide(directWith(0.95), cpuWith(0.95))).toMatchObject({ case: 'B2C2B2I_REJECTED_NO_EFFECT', adoption: 'reject' })
    expect(decide(directWith(0.9499), cpuWith(0.95)).case).toBe('B2C2B2I_PARTIAL')
    expect(decide(directWith(0.95), cpuWith(0.9499)).case).toBe('B2C2B2I_PARTIAL')
    expect(decide(directWith(1), cpuWith(null)).case).toBe('B2C2B2I_PARTIAL')
    // Semantic mismatch rejects whatever the speed; INVALID and INSUFFICIENT come first.
    const mismatch = directWith(0.3, { semanticParity: false, firstMismatch: { index: 4, before: {}, after: {} } })
    expect(decide(mismatch, cpuWith(0.1))).toMatchObject({ case: 'B2C2B2I_REJECTED_SEMANTIC_MISMATCH', adoption: 'reject' })
    expect(decide(directWith(0.3), cpuWith(0.1), [], false)).toMatchObject({ case: 'B2C2B2I_REJECTED_SEMANTIC_MISMATCH', adoption: 'reject' })
    expect(decide(mismatch, cpuWith(0.1), ['hash_chain: x'])).toMatchObject({ case: 'B2C2B2I_INVALID', adoption: 'undecided' })
    expect(decide(null, cpuWith(0.1)).case).toBe('B2C2B2I_INSUFFICIENT')
    expect(decide(directWith(null, { issues: ['no common held-aware depth record'], semanticParity: false }), cpuWith(0.1)).case).toBe('B2C2B2I_INSUFFICIENT')
  })

  it('records peak heap / RSS of both runs as description only', () => {
    expect(phase2c26b2c2b2iMemory({ peakHeapBytes: 100, peakRssBytes: 200 }, { peakHeapBytes: 150, peakRssBytes: 100 })).toMatchObject({ heapRatio: 1.5, rssRatio: 0.5 })
    expect(phase2c26b2c2b2iMemory({ peakHeapBytes: null, peakRssBytes: 0 }, { peakHeapBytes: 1, peakRssBytes: 1 })).toMatchObject({ heapRatio: null, rssRatio: null })
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't05-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const OBS_IDENTITIES: Phase2C26B2C2B2FTaskIdentity[] = [{ taskId: 't05-r03', targetWeaponId: 't1', contextRank: 3, groupIndex: 1, reservationDigest: 'r', targetEligibleMinCardinality: 1,
  representativeFixedSetId: 'k', representativeFixedTargetWeaponIds: ['t9'], defaultSearchInputDigest: 'd', searchInputDigest: 's', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const BEFORE_FILES = Object.fromEntries(PHASE2C26B2C2B2I_BEFORE_FILES.map((name, index) => [name, String(index).repeat(64)])) as Record<Phase2C26B2C2B2IBeforeFile, string>
const reg = PHASE2C26B2C2B2I_REGISTERED_B2C2B2H
const observation0 = { createdAt: '2026-10-06T15:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2i.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestB2C2B2HResultSha256: reg.resultSha256, probeManifestB2C2B2GResultSha256: reg.b2c2b2gResultSha256, probeManifestB2C2B2FResultSha256: reg.b2c2b2fResultSha256,
  probeManifestB2C2B2EResultSha256: reg.b2c2b2eResultSha256, targetWeaponIds: ['t1'], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, b2c2b2hResultSha256: reg.resultSha256,
  b2c2b2hMeasuredHead: reg.measuredHead, b2c2b2hBeforeFiles: { ...BEFORE_FILES }, productionChangedFiles: [...PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES], optimizationSourceCheckValid: true,
  stage1: { ...PHASE2C26B2C2B2I_STAGE1 }, cpuProfilerConfig: { ...PHASE2C26B2C2B2I_CPU_PROFILER }, smoke: null }
const expectation: Phase2C26B2C2B2IAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2hResultSha256: reg.resultSha256, b2c2b2hMeasuredHead: reg.measuredHead, b2c2b2gResultSha256: reg.b2c2b2gResultSha256, b2c2b2fResultSha256: reg.b2c2b2fResultSha256,
  b2c2b2eResultSha256: reg.b2c2b2eResultSha256, b2c2b2hBeforeFiles: BEFORE_FILES, productionChangedFiles: [...PHASE2C26B2C2B2I_PRODUCTION_CHANGED_FILES], probes: OBS_PROBES,
  expectedTaskIdentities: OBS_IDENTITIES, firstChildStartedAt: '2026-10-06T15:00:00.100Z' }

describe('Phase 2-C2.6-B2-C2B2I runner start attestation', () => {
  it('verifies a clean formal launch and fails closed on every attested field, the before files, the Production change, the source check and the registered conditions', () => {
    const body = phase2c26b2c2b2iStartAttestationBody(observation0)
    expect(body).toMatchObject({ phase: PHASE2C26B2C2B2I_START_ATTESTATION_PHASE, attestedBy: 'runner', changedFromB2C2B2H: [...PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H] })
    expect(verifyPhase2C26B2C2B2IStartAttestation(body, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const fails = (patch: Json, expected: Partial<Phase2C26B2C2B2IAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2IStartAttestation({ ...structuredClone(body), ...patch }, { ...expectation, ...expected }).verified === false
    expect(fails({ createdAt: '2026-10-06T15:00:01.000Z' })).toBe(true)
    expect(fails({ repositoryHead: 'e'.repeat(40) })).toBe(true)
    expect(fails({ benchmarkCodeSha256: 'x' })).toBe(true)
    expect(fails({ exportSha256: 'x' })).toBe(true)
    expect(fails({ probeManifestSha256: 'x' })).toBe(true)
    expect(fails({ b2c2b2hResultSha256: '9'.repeat(64) })).toBe(true)
    expect(fails({ b2c2b2hMeasuredHead: 'f'.repeat(40) })).toBe(true)
    expect(fails({ probeManifestB2C2B2GResultSha256: '9'.repeat(64) })).toBe(true)
    expect(fails({ b2c2b2hBeforeFiles: { ...BEFORE_FILES, cpuProfile: 'e'.repeat(64) } })).toBe(true)
    expect(fails({ productionChangedFiles: ['src/domain/search/bonusStream.ts', 'src/domain/rng/gogmaBonusFamily.ts'] })).toBe(true)
    expect(fails({}, { productionChangedFiles: ['src/domain/rng/gogmaBonusFamily.ts'] })).toBe(true)
    expect(fails({ optimizationSourceCheckValid: false })).toBe(true)
    expect(fails({ uncommittedBenchmarkCode: true })).toBe(true)
    expect(fails({ smoke: { budgetMs: 1, warmupMs: null, profileStopMs: null } })).toBe(true)
    expect(fails({ stage1: { ...PHASE2C26B2C2B2I_STAGE1, budgetMs: 3_600_000 } })).toBe(true)
    expect(fails({ cpuProfilerConfig: { ...PHASE2C26B2C2B2I_CPU_PROFILER, warmupMs: 60_000 } })).toBe(true)
    expect(fails({ changedFromB2C2B2H: [] })).toBe(true)
    expect(fails({ optimization: { id: 'other' } })).toBe(true)
    expect(fails({ extra: true })).toBe(true)
    expect(fails({ attestedBy: 'analyzer' })).toBe(true)
    expect(verifyPhase2C26B2C2B2IStartAttestation(null, expectation).verified).toBe(false)
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2I isolation and provenance', () => {
  it('is never imported by Production, adds no Production seam, and hard-codes no Target, task, rank, extent or digest value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2I|predictKeepCacheParity/.test(source)).map(([path]) => path)).toEqual([])
    // The optimization adds no export, no observer and no instrumentation option to the stream.
    expect(bonusStreamSource).not.toMatch(/export (const|function) .*keepPredictions|onKeepPrediction|observeKeep/)
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|a367c177|4a875aac/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(1083|1084)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps every RESULT and every B2-C2B2H measurement out of the Search child: only the parent reads the B2-C2B2H RESULT, to attest SHA-256s', () => {
    const child = runnerSource.slice(runnerSource.indexOf("if (role !== 'parent') {"), runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    const parent = runnerSource.slice(runnerSource.indexOf('// -------------------------------------------------------------------- parent'))
    expect(child.length).toBeGreaterThan(1000)
    expect(child).not.toMatch(/b2c2b2h-result|b2c2b2h-raw|b2c2b2h-run-dir|rawB2C2B2H|Targets\.ts|parsePhase2C26B2C2B2IB2C2B2HAuthority|keepPredictionShare|beforeFiles/)
    expect(child).toMatch(/i\.runPhase2C26B2C2B2ITask\(input, schedule, task, engine, \{ yieldControl, instrumentation: profiler\.instrumentation \}\)/)
    expect(child).toMatch(/new Session\(\)/)
    // The child arguments carry no before evidence.
    const childArgs = /const childArgs = \[([\s\S]*?)\]\n/.exec(parent)?.[1] ?? ''
    expect(childArgs).toMatch(/--role/)
    expect(childArgs).not.toMatch(/b2c2b2h|RESULT|before/i)
    expect(parent).toMatch(/--b2c2b2h-result/)
    expect(parent).toMatch(/phase2c26b2c2b2iOptimizationSourceCheck\(gitShow\(/)
    expect(parent).toMatch(/no formal run/)
    expect(runnerSource).not.toMatch(/--cpu-prof|--no-turbo-inlining|--no-maglev-inlining|--inspect|HeapProfiler|takeHeapSnapshot|startSampling/)
    expect(prepareSource).toMatch(/--b2c2b2h-result/)
    expect(prepareSource).not.toMatch(/--oracle|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).not.toMatch(/--oracle|ORACLE_[1]657|PHASE2C26A5_RESULT|PHASE2C26A8_RESULT|PHASE2C26A9_RESULT/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DFGHI]Search\(|runPhase2C26B2C2B2[DFGHI]Task\(/)
    expect(searchSource).not.toMatch(/onSkillReservedDepth:|onGogmaReservedDepth:|onWorkSettled:/)
    expect(searchSource).not.toMatch(/Date\.now|performance\.now/)
  })
})

// ---------------------------------------------------------------- the committed formal RESULT

describe('Phase 2-C2.6-B2-C2B2I committed RESULT', () => {
  const result = JSON.parse(rawResult)
  const MEASURED_HEAD = '8f34b9772937c13c36102106722eab23094a9cb7'
  const after = (category: string) => result.profiles.after.categories.find((c: { category: string }) => c.category === category)

  it('is formal: runner start attestation verified against the independently obtained HEAD / code / Export / manifest / B2-C2B2H (and its before files) / B2-C2B2G / B2-C2B2F / B2-C2B2E, no invalid reason', () => {
    expect(result.provenance).toMatchObject({ formal: true, evidenceGrade: 'formal', partialRun: false, launchProvenanceVerified: true, launchProvenanceSource: 'runner_start_attestation',
      launchProvenanceIssues: [], launchProvenanceIntegrityIssues: [], measuredHead: MEASURED_HEAD, analysisHead: MEASURED_HEAD, measuredHeadIsAncestor: true, uncommittedBenchmarkCode: false,
      smoke: null, calculationCodeChangedSinceMeasuredHead: [], b2c2b2hResultSha256: reg.resultSha256, b2c2b2hMeasuredHead: reg.measuredHead, b2c2b2gResultSha256: reg.b2c2b2gResultSha256,
      b2c2b2fResultSha256: reg.b2c2b2fResultSha256, b2c2b2eResultSha256: reg.b2c2b2eResultSha256, exportSha256: hJson.provenance.exportSha256, optimization: true,
      productionOptimizationId: PHASE2C26B2C2B2I_OPTIMIZATION.id, routeExactJudged: false, oracleReadBySearchChild: false })
    expect(result.provenance.benchmarkCodeSha256).toBe(result.provenance.recomputedBenchmarkCodeSha256)
    expect(result.provenance.startAttestation.body).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2I_START_ATTESTATION_PHASE, repositoryHead: MEASURED_HEAD, smoke: null,
      uncommittedBenchmarkCode: false, stage1: PHASE2C26B2C2B2I_STAGE1, cpuProfilerConfig: PHASE2C26B2C2B2I_CPU_PROFILER, productionChangedFiles: ['src/domain/search/bonusStream.ts'],
      optimizationSourceCheckValid: true, b2c2b2hResultSha256: reg.resultSha256, changedFromB2C2B2H: [...PHASE2C26B2C2B2I_CHANGED_FROM_B2C2B2H] })
    expect(result.provenance.startAttestation.body.createdAt).toBe(result.provenance.measuredAt)
    expect(result.invalidReasons).toEqual([])
    expect(result.afterProfileQualityIssues).toEqual([])
    expect(Object.values(result.parity.hashChain).every(v => v === true)).toBe(true)
    expect(Object.values(result.conditions.conditionChecks).every(v => v === true)).toBe(true)
    // The before evidence: every local B2-C2B2H raw file is the one the B2-C2B2H RESULT recorded.
    for (const name of PHASE2C26B2C2B2I_BEFORE_FILES) expect(result.sources.b2c2b2hBefore[name]).toMatchObject({ recordedSha256: hJson.sources[name].sha256, localSha256: hJson.sources[name].sha256, matches: true })
    expect(result.provenance.startAttestation.body.b2c2b2hBeforeFiles).toEqual(Object.fromEntries(PHASE2C26B2C2B2I_BEFORE_FILES.map(name => [name, hJson.sources[name].sha256])))
  })

  it('changed exactly the registered Production source since B2-C2B2H\'s measured HEAD, in the registered shape, and searched B2-C2B2H\'s Target in B2-C2B2H\'s Search input', async () => {
    expect(result.productionChange).toMatchObject({ beforeHead: reg.measuredHead, afterHead: MEASURED_HEAD, productionChangedFiles: ['src/domain/search/bonusStream.ts'], equalsRegistered: true,
      equalsRunnerAttested: true, sourceCheck: { valid: true, onlyRegisteredRegionsChanged: true, afterHasCompositeKey: false, frontierReductionKeyUnchanged: true, resetMemoUnchanged: true } })
    expect(result.productionChange.changedPaths.filter((path: string) => !isPhase2C26B2C2B2IResearchOrTestPath(path))).toEqual(['src/domain/search/bonusStream.ts'])
    const derived = phase2c26b2c2b2iPopulation(authorityH(), parsedG.authority, parsedF.authority, parsedE.authority)
    expect(result.population.targetWeaponIds).toEqual(derived.targetWeaponIds)
    expect(result.population.probes).toEqual(hJson.population.probes)
    expect(result.parity.population).toMatchObject({ manifestEqualsDerived: true, runnerTargetsEqualManifest: true, runnerProbesEqualManifest: true, runnerIdentitiesEqualManifest: true,
      probesEqualB2C2B2HProfiled: true, identitiesEqualB2C2B2HProfiled: true, targets: 1 })
    expect(result.parity.identity).toMatchObject({ rawEqualsExpected: true, expected: hJson.parity.identity.expected })
    expect(result.parity.taskRebuild).toMatchObject({ valid: true, tasksEqualRebuilt: true })
    expect(Object.values(result.parity.childIdentity).every(v => v === true)).toBe(true)
    const route = result.parity.excludedRoute
    expect([route.childAttestedExcludedRouteKeySha256, route.b2c2b2hExcludedRouteKeySha256]).toEqual([route.rederivedExcludedRouteKeySha256, route.rederivedExcludedRouteKeySha256])
    expect(route.rederivedExcludedRouteKeySha256).toBe(hJson.parity.excludedRoute.rederivedExcludedRouteKeySha256)
    // The frozen pre-optimization record the committed regression test compares with is the one at the measured HEAD.
    expect(result.semanticParity.committedRegressionTests.files['src/test/fixtures/predictKeepCachePreB2I.json']).toBe(await sha256(rawFrozen))
  })

  it('pins semantic parity and the direct comparison: 411 identical common held-aware depths, state_generation 969.9 s -> 715.1 s (ratio 0.737)', () => {
    expect(result.semanticParity).toMatchObject({ valid: true, searchInputAndExcludedRoute: { valid: true } })
    const d = result.directComparison
    expect(d).toMatchObject({ valid: true, issues: [], semanticParity: true, beforeDepths: 411, afterDepths: 480, commonDepths: 411, firstMismatch: null, commonGeneratedStates: 738_616_871 })
    expect(d.beforeDepths).toBe(hJson.intervals.depthRecordsCollected)
    expect(d.stateGenerationDirectRatio).toBeCloseTo(d.afterStateGenerationMs / d.beforeStateGenerationMs, 12)
    expect(d.stateGenerationDirectRatio).toBeGreaterThan(0.73)
    expect(d.stateGenerationDirectRatio).toBeLessThan(0.74)
    expect(d.byThird.every((t: { ratio: number }) => t.ratio < PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO)).toBe(true)
    // The sections the optimization does not touch stay within 5 % on the same work.
    expect(d.otherSections.every((s: { ratio: number }) => Math.abs(s.ratio - 1) < 0.05)).toBe(true)
  })

  it('pins the hotspot: keep_prediction 31.33 % -> 14.27 % of active CPU (ratio 0.455), the composite key and its lookup gone from predictKeep', () => {
    const cpu = result.cpuHotspot
    expect(cpu).toMatchObject({ beforeRecordedShare: hJson.decision.secondary[0].shareOfActive, beforeReproduced: true, beforeProfileValid: true, afterProfileValid: true, afterSourceHasCompositeKey: false })
    expect(cpu.beforeRecomputedShare).toBe(cpu.beforeRecordedShare)
    expect(cpu.keepPredictionShareRatio).toBeCloseTo(cpu.afterShare / cpu.beforeRecordedShare, 12)
    expect(cpu.keepPredictionShareRatio).toBeGreaterThan(0.45)
    expect(cpu.keepPredictionShareRatio).toBeLessThan(0.46)
    expect(after('keep_prediction').samples).toBe(3_926)
    expect(result.profiles.after.samples).toEqual({ all: 57_425, interval: 28_304, idle: 788, active: 27_516 })
    expect(result.profiles.after).toMatchObject({ valid: true, registeredLineMismatches: [], clockAlignment: { valid: true, negativeTimeDeltas: 0 }, window: { stoppedBy: 'window', error: null } })
    expect(result.profiles.after.unattributedActiveShare).toBeLessThan(0.5)
    expect(cpu.afterPredictKeepLineTicks.inSpan.map((l: { text: string }) => l.text).join('\n')).not.toMatch(/\\u0000/)
    expect(cpu.afterPredictKeepLineTicks.inSpan.find((l: { ticks: number }) => l.ticks > 1000).text).toBe('const cached = byFamilyLayout?.get(familyLayoutKey)')
    expect(result.profiles.after.registeredInclusive.some((r: { registered: string }) => r.registered.endsWith('#predictGogmaBonus'))).toBe(false)
  })

  it('pins the pre-registered decision: ADOPTED, recomputed from the recorded comparisons', () => {
    expect(result.thresholds).toEqual({ adoptMaxKeepShareRatio: 0.75, adoptMaxDirectRatio: 0.9, regressionDirectRatio: 1.05, noEffectRatio: 0.95 })
    expect(result.decision).toMatchObject({ case: 'B2C2B2I_ADOPTED', adoption: 'adopt', reasons: [], stateGenerationDirectRatio: result.directComparison.stateGenerationDirectRatio,
      keepPredictionShareRatio: result.cpuHotspot.keepPredictionShareRatio })
    expect(phase2c26b2c2b2iDecision({ invalidReasons: [], identityParity: true, direct: result.directComparison, cpu: result.cpuHotspot }).case).toBe('B2C2B2I_ADOPTED')
    expect(result.outcome).toMatchObject({ process: 'timeout', record: null, naturalCompletion: false, budgetMs: 1_800_000, completedDepths: 480, deliveredBeforeKill: { deliveryFlushes: 0, deliveryConsumerCalls: 0 } })
    expect(result.memory.heapRatio).toBeLessThan(1.05)
  })
})
