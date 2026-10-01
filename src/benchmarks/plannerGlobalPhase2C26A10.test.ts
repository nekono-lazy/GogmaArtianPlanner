import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import rawA5 from '../../docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json?raw'
import rawA6 from '../../docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json?raw'
import rawA7 from '../../docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json?raw'
import rawA8 from '../../docs/PLANNER_GLOBAL_PHASE2C26A8_RESULT.json?raw'
import rawA9 from '../../docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json?raw'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { phase2c2KernelRequest, phase2c2ProductionDefaultConditions, type Phase2C2ChildOutcome, type Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { PHASE2C26A_CHILD_HEAP_MB, PHASE2C26A_CONCURRENCY, PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS, PHASE2C26A_NODE_YIELD, PHASE2C26A_ORIENTATION_BUDGET_MS } from './plannerGlobalPhase2C26A'
import type { Phase2C26AKernelTarget, Phase2C26ARawKernel } from './plannerGlobalPhase2C26AAnalysis'
import {
  parsePhase2C26A9ResultAuthority,
  phase2c26a10A9ChainFiles,
  phase2c26a10KernelTasks,
  runPhase2C26A10Kernel,
  validatePhase2C26A10TaskSet,
  PHASE2C26A10_A9_CHAIN_KEYS,
  PHASE2C26A10_CHILD_HEAP_MB,
  PHASE2C26A10_CONCURRENCY,
  PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A10_NODE_FLAGS,
  PHASE2C26A10_NODE_YIELD,
  PHASE2C26A10_NOT_ATTACHED,
  PHASE2C26A10_ORIENTATION_BUDGET_MS,
} from './plannerGlobalPhase2C26A10'
import a10Source from './plannerGlobalPhase2C26A10.ts?raw'
import {
  comparePhase2C26A10ExtendedSemantics,
  comparePhase2C26A10WithC26A,
  compactPhase2C26A10Kernel,
  parsePhase2C26A10Before,
  phase2c26a10Conclusion,
  phase2c26a10Decision,
  phase2c26a10FoundSummary,
  phase2c26a10Transitions,
  validatePhase2C26A10Comparability,
  validatePhase2C26A10FormalRun,
  PHASE2C26A10_DECISION_RULE,
  type Phase2C26A10Before,
} from './plannerGlobalPhase2C26A10Analysis'
import analysisSource from './plannerGlobalPhase2C26A10Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26a10.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26a10.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-A10. The whole C2.6-A orientation set re-run against the current Production under the C2.6-A
 * conditions. The committed C2.6-A RESULT is the before / parity authority, the committed A9 RESULT the authority chain.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const c26aJson = JSON.parse(rawC26a)
const a9Json = JSON.parse(rawA9)
const chainRaw: Record<string, string> = { c26a2Result: rawA2, c26a3Result: rawA3, c26a4Result: rawA4, c26a5Result: rawA5, c26a6Result: rawA6, c26a7Result: rawA7, c26a8Result: rawA8 }
let shas: { c26a: string; a9: string; chain: Record<string, string> }
const parsedBefore = parsePhase2C26A10Before(structuredClone(c26aJson))
const before = parsedBefore.before as Phase2C26A10Before
const authority = before.authority
const conditions = phase2c2ProductionDefaultConditions()
const expectations = { childHeapLimitMb: 8192, concurrency: 3, orientationBudgetMs: 1_800_000, conditions }

beforeAll(async () => {
  const chain: Record<string, string> = {}
  for (const [key, raw] of Object.entries(chainRaw)) chain[key] = await sha256Hex(raw)
  shas = { c26a: await sha256Hex(rawC26a), a9: await sha256Hex(rawA9), chain }
})

// ---------------------------------------------------------------- synthetic current kernels rebuilt from the C2.6-A rows

/** Identity "hash": the rebuilt kernels carry the recorded SHA-256s as their raw keys. */
const identity = (value: string) => value

/** A current kernel that judges exactly as C2.6-A did for a completed row; a failed child for any other status. */
function kernelOf(orientation: Phase2C2Orientation, outcome: Phase2C2ChildOutcome, change?: (targets: Phase2C26AKernelTarget[]) => void): Phase2C26ARawKernel {
  const row = before.view.rows.get(orientation.orientationId)!
  const completed = outcome === 'completed'
  let targets: Phase2C26AKernelTarget[]
  if (row.kernelStatus === 'completed') {
    targets = row.targets.map((t, index) => {
      const extended = row.extendedTargets[index]
      return { targetWeaponId: t.targetWeaponId, outcome: t.outcome, reservation: t.searched ? {} : null, search: extended.search,
        trials: t.trials.map(trial => ({ candidateKey: trial.candidateKeySha256, result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })),
        found: extended.found === null ? null : { stableKey: extended.found.stableKeySha256, generatedSelected: extended.found.generatedSelected as boolean, trialPlan: extended.found.trialPlan, summary: extended.found.summary },
        skippedExcludedRouteKeys: extended.skippedExcludedRouteKeys as number }
    })
  } else {
    // A C2.6-A timeout has no judgement: a completed current child of it gets a plain extent-bound result per non-fixed Target.
    targets = orientation.participantTargetWeaponIds.filter(id => id !== orientation.fixedTargetWeaponId).map(id => ({ targetWeaponId: id, outcome: 'stopped_by_search_extent_bound',
      reservation: {}, search: { deliveredCandidates: 0, excludedCandidates: 0, exhausted: false, stoppedByExtent: true, stoppedByConsumer: false }, trials: [], found: null, skippedExcludedRouteKeys: 0 }))
  }
  change?.(targets)
  return {
    orientationId: orientation.orientationId, task: { orientation: structuredClone(orientation), conditions: structuredClone(conditions) },
    process: { outcome, wallMs: completed ? 1000 : 1_800_000, exitCode: completed ? 0 : null, signal: completed ? null : 'SIGKILL', timedOut: outcome === 'timeout', stderrTail: completed ? null : 'x',
      lastIpcMemory: { samples: 4, maxHeapUsedBytes: 1000, maxRssBytes: 2000, lastElapsedMs: 1 }, lastIpcYields: 3, ...({ id: `kernel-${orientation.orientationId}`, role: 'kernel' }) } as Phase2C26ARawKernel['process'],
    childWallMs: completed ? 900 : null, memory: completed ? { samples: 4, sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 300, heapSizeLimitBytes: 8_800_000_000 } : null,
    record: completed ? { orientation, conditions, kernel: { status: 'completed', plannerRerunsUsed: row.plannerRerunsUsed ?? 0, explicitDecisionBuildListEntryIds: [orientation.fixedBuildListEntryId], targets },
      timing: { kernelMs: 1 } } as unknown as Phase2C26ARawKernel['record'] : null,
  }
}

/** A complete synthetic formal A10 series over the authority orientations; by default every child as C2.6-A recorded it. */
function rawRun(outcomeOf: (o: Phase2C2Orientation) => Phase2C2ChildOutcome = o => before.view.rows.get(o.orientationId)!.outcome as Phase2C2ChildOutcome) {
  const kernels = authority.orientations.map(o => kernelOf(o, outcomeOf(o)))
  return {
    status: 'completed',
    environment: { smoke: null, uncommittedBenchmarkCode: false, childHeapLimitMb: 8192, concurrency: 3, orientationBudgetMs: 1_800_000, exportSha256: authority.conditions.exportSha256,
      nodeYield: 'setImmediate', nodeFlags: ['--max-old-space-size=8192'], memorySampleIntervalMs: 250, notAttached: [...PHASE2C26A10_NOT_ATTACHED],
      c26aResultSha256: shas.c26a, a9ResultSha256: shas.a9, a9ChainResultSha256: { ...shas.chain } },
    conditions: structuredClone(conditions),
    baselineParity: { valid: true }, conditionParity: { valid: true }, taskSet: { valid: true },
    baseline: { process: { outcome: 'completed' }, researchMaxPlanSteps: 20_000, calculationContext: structuredClone(authority.conditions.calculationContext),
      record: { summary: structuredClone(authority.baseline), orientations: structuredClone(authority.orientations) } },
    kernels,
    processes: [{ role: 'baseline' }, ...kernels.map(k => ({ role: 'kernel', id: `kernel-${k.orientationId}` }))],
  }
}

const timeoutIds = () => before.timeoutOrientationIds
const isOldTimeout = (o: Phase2C2Orientation) => timeoutIds().includes(o.orientationId)

describe('conditions', () => {
  it('keeps every Phase 2-C2.6-A formal Node condition (concurrency 3, not A9\'s 1) and attaches nothing', () => {
    expect(PHASE2C26A10_CHILD_HEAP_MB).toBe(PHASE2C26A_CHILD_HEAP_MB)
    expect(PHASE2C26A10_CONCURRENCY).toBe(PHASE2C26A_CONCURRENCY)
    expect(PHASE2C26A10_ORIENTATION_BUDGET_MS).toBe(PHASE2C26A_ORIENTATION_BUDGET_MS)
    expect(PHASE2C26A10_MEMORY_SAMPLE_INTERVAL_MS).toBe(PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS)
    expect(PHASE2C26A10_NODE_YIELD).toBe(PHASE2C26A_NODE_YIELD)
    expect([...PHASE2C26A10_NODE_FLAGS]).toEqual(['--max-old-space-size=8192'])
    expect(authority.conditions).toMatchObject({ childHeapLimitMb: PHASE2C26A10_CHILD_HEAP_MB, concurrency: PHASE2C26A10_CONCURRENCY,
      orientationBudgetMs: PHASE2C26A10_ORIENTATION_BUDGET_MS, nodeYield: PHASE2C26A10_NODE_YIELD, researchMaxPlanSteps: 20_000 })
    expect(authority.conditions.concurrency).not.toBe(a9Json.conditions.concurrency)
    expect([...PHASE2C26A10_NOT_ATTACHED]).toEqual(expect.arrayContaining(['cpu_profiler', 'no_inlining_diagnostic', 'heartbeat']))
  })

  it('changes no Production default, schema or version, and equals the C2.6-A extent / bounds / CalculationContext', () => {
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(authority.conditions.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(authority.conditions.bounds).toEqual(defaultPlannerAlternativeTrialBounds)
    expect(authority.conditions.calculationContext).toMatchObject({ appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION })
    expect(authority.conditions.lineage).toEqual({ priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] })
  })
})

describe('the full task set', () => {
  it('runs every authority orientation once, in order, with Production defaults and an empty lineage', () => {
    const tasks = phase2c26a10KernelTasks(authority.orientations)
    expect(tasks.map(t => t.orientation)).toEqual(authority.orientations)
    expect(validatePhase2C26A10TaskSet(tasks, authority)).toMatchObject({ valid: true, expected: authority.orientations.length, actual: authority.orientations.length })
    for (const task of tasks) expect(task.conditions).toEqual(conditions)
    expect(runPhase2C26A10Kernel).toBeTypeOf('function')
    expect(a10Source).toMatch(/return runPhase2C26AKernel\(input, task, dependencies\)/)
    expect(phase2c2KernelRequest).toBeTypeOf('function')
  })

  it('rejects a subset (e.g. only the old timeouts), a reorder, a duplicate, a foreign and a changed orientation', () => {
    const tasks = phase2c26a10KernelTasks(authority.orientations)
    const subset = tasks.filter(t => isOldTimeout(t.orientation))
    expect(validatePhase2C26A10TaskSet(subset, authority)).toMatchObject({ valid: false })
    expect(validatePhase2C26A10TaskSet(subset, authority).missing.length).toBe(authority.orientations.length - subset.length)
    expect(validatePhase2C26A10TaskSet([...tasks].reverse(), authority)).toMatchObject({ valid: false, orderedIdsMatch: false })
    expect(validatePhase2C26A10TaskSet([...tasks, tasks[0]], authority).duplicate).toEqual([tasks[0].orientation.orientationId])
    const foreign = [...tasks, { ...tasks[0], orientation: { ...tasks[0].orientation, orientationId: 'foreign' } }]
    expect(validatePhase2C26A10TaskSet(foreign, authority).foreign).toEqual(['foreign'])
    const changed = tasks.map((t, i) => (i === 1 ? { ...t, orientation: { ...t.orientation, fixedBuildListEntryId: 'other' } } : t))
    expect(validatePhase2C26A10TaskSet(changed, authority).metadataMismatches).toEqual([{ orientationId: tasks[1].orientation.orientationId, fields: ['fixedBuildListEntryId'] }])
  })
})

describe('the A9 RESULT authority chain', () => {
  const mutate = (change: (json: typeof a9Json) => void) => {
    const json = structuredClone(a9Json)
    change(json)
    return parsePhase2C26A9ResultAuthority(json, { c26a: shas.c26a, chain: shas.chain }, authority)
  }

  it('accepts the committed A9 RESULT: formal, Case O, made against exactly the C2.6-A and A2 .. A8 files read', () => {
    expect(phase2c26a10A9ChainFiles(a9Json)).toEqual(Object.fromEntries(PHASE2C26A10_A9_CHAIN_KEYS.map(({ source }) => [source, a9Json.sources[source].file])))
    const parsed = parsePhase2C26A9ResultAuthority(structuredClone(a9Json), { c26a: shas.c26a, chain: shas.chain }, authority)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'O_optimization_adopted', measuredHead: a9Json.provenance.measuredHead, concurrency: 1, cpuProfiler: true })
    expect(parsed.authority!.primaries.map(p => p.orientationId)).toEqual(a9Json.summary.byPrimary.map((p: { orientationId: string }) => p.orientationId))
    // A9's primaries are C2.6-A timeouts (a reference only; A10 selects nothing from them).
    for (const primary of parsed.authority!.primaries) expect(timeoutIds()).toContain(primary.orientationId)
  })

  it('fails closed on a non-formal, non-O, changed-code, foreign-chain or foreign-Export A9 RESULT', () => {
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'P_partial_or_shifted' }).valid).toBe(false)
    expect(mutate(json => { json.conclusion.decision.case = 'N_not_adopted' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.provenance.c26aResultSha256 = '0'.repeat(64) }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a8Result.sha256 = '0'.repeat(64) }).valid).toBe(false)
    expect(mutate(json => { json.provenance.c26a4ResultRecordedByRunner = '0'.repeat(64) }).valid).toBe(false)
    expect(mutate(json => { json.provenance.exportSha256 = '0'.repeat(64) }).valid).toBe(false)
    expect(mutate(json => { delete json.sources.c26a5Result }).valid).toBe(false)
    expect(parsePhase2C26A9ResultAuthority(structuredClone(a9Json), { c26a: '0'.repeat(64), chain: shas.chain }, authority).valid).toBe(false)
    expect(parsePhase2C26A9ResultAuthority(structuredClone(a9Json), { c26a: shas.c26a, chain: { ...shas.chain, c26a2Result: '0'.repeat(64) } }, authority).valid).toBe(false)
  })
})

describe('the C2.6-A RESULT as the before authority', () => {
  it('reads every row and derives the before counts from the RESULT itself', () => {
    expect(parsedBefore.issues).toEqual([])
    expect(before.view.rows.size).toBe(authority.orientations.length)
    expect(before.childStatus).toEqual(c26aJson.kernel.childStatus)
    expect(before.timeoutOrientationIds).toEqual(c26aJson.perOrientation.filter((r: { child: { outcome: string } }) => r.child.outcome === 'timeout').map((r: { orientationId: string }) => r.orientationId))
    expect(before.completedOrientationIds.length + before.timeoutOrientationIds.length).toBe(authority.orientations.length)
    for (const id of before.completedOrientationIds) {
      const row = before.view.rows.get(id)!
      expect(row.kernelStatus).toBe('completed')
      expect(row.targets.length).toBeGreaterThan(0)
      expect(row.extendedTargets.map(t => t.targetWeaponId)).toEqual(row.targets.map(t => t.targetWeaponId))
    }
    for (const id of before.timeoutOrientationIds) expect(before.view.rows.get(id)!.targets).toEqual([])
    expect(before.participants.participantsNotSearched).toEqual(c26aJson.participants.participantsNotSearched)
  })

  it('fails closed on a malformed or contradictory C2.6-A RESULT', () => {
    expect(parsePhase2C26A10Before(null).valid).toBe(false)
    const notFormal = structuredClone(c26aJson); notFormal.provenance.formal = false
    expect(parsePhase2C26A10Before(notFormal).valid).toBe(false)
    const completedId = before.completedOrientationIds[0]
    const noJudgement = structuredClone(c26aJson)
    noJudgement.perOrientation.find((r: { orientationId: string }) => r.orientationId === completedId).kernel = { status: 'process_timeout' }
    expect(parsePhase2C26A10Before(noJudgement).valid).toBe(false)
    const timeoutWithJudgement = structuredClone(c26aJson)
    timeoutWithJudgement.perOrientation.find((r: { orientationId: string }) => r.orientationId === before.timeoutOrientationIds[0]).kernel = { status: 'completed', targets: [] }
    expect(parsePhase2C26A10Before(timeoutWithJudgement).valid).toBe(false)
    const badTrial = structuredClone(c26aJson)
    const row = badTrial.perOrientation.find((r: { kernel: { targets?: { trials: unknown[] }[] } }) => r.kernel.targets?.some(t => t.trials.length > 0))
    row.kernel.targets.find((t: { trials: unknown[] }) => t.trials.length > 0).trials[0] = { result: 'found' }
    expect(parsePhase2C26A10Before(badTrial).valid).toBe(false)
  })
})

describe('formal series and comparability (post-hoc, fail closed)', () => {
  it('accepts a complete series of the authority orientations with every gate valid', () => {
    const raw = rawRun()
    const formal = validatePhase2C26A10FormalRun(raw, expectations, shas)
    expect(formal.failures).toEqual([])
    const comparability = validatePhase2C26A10Comparability(raw, before)
    expect(comparability.issues).toEqual([])
    expect(comparability.c26aStyle.orientations).toMatchObject({ matches: true, orderedIdsMatch: true, countMatches: true })
  })

  it('rejects a subset / smoke run, other SHA-256s, another concurrency, attached instrumentation and failed runner gates', () => {
    const validate = (raw: unknown) => validatePhase2C26A10FormalRun(raw, expectations, shas)
    const subset = rawRun(); subset.kernels = subset.kernels.filter(k => isOldTimeout(k.task.orientation))
    expect(validate(subset).valid).toBe(false)
    const smoke = rawRun(); (smoke.environment as Record<string, unknown>).smoke = { orientationIds: [authority.orientations[0].orientationId] }
    expect(validate(smoke).valid).toBe(false)
    const c26aSha = rawRun(); c26aSha.environment.c26aResultSha256 = '0'.repeat(64)
    expect(validate(c26aSha).shaMatches.c26a).toBe(false)
    const a9Sha = rawRun(); a9Sha.environment.a9ResultSha256 = '0'.repeat(64)
    expect(validate(a9Sha).valid).toBe(false)
    const chainSha = rawRun(); chainSha.environment.a9ChainResultSha256.c26a7Result = '0'.repeat(64)
    expect(validate(chainSha).valid).toBe(false)
    const a9Concurrency = rawRun(); a9Concurrency.environment.concurrency = 1
    expect(validate(a9Concurrency).valid).toBe(false)
    expect(validatePhase2C26A10Comparability(a9Concurrency, before).valid).toBe(false)
    const profiled = rawRun(); profiled.environment.nodeFlags = ['--max-old-space-size=8192', '--cpu-prof']
    expect(validate(profiled).valid).toBe(false)
    const attached = rawRun(); attached.environment.notAttached = ['heartbeat']
    expect(validate(attached).valid).toBe(false)
    const gate = rawRun(); gate.baselineParity.valid = false
    expect(validate(gate).runnerParity.baselineParity).toBe(false)
  })

  it('rejects another Export, baseline, orientation order / metadata, extent, maxPlanSteps or CalculationContext', () => {
    const invalid = (change: (raw: ReturnType<typeof rawRun>) => void) => { const raw = rawRun(); change(raw); return validatePhase2C26A10Comparability(raw, before).valid }
    expect(invalid(raw => { raw.environment.exportSha256 = '0'.repeat(64) })).toBe(false)
    expect(invalid(raw => { raw.baseline.record.summary.planSteps = (raw.baseline.record.summary.planSteps ?? 0) + 1 })).toBe(false)
    expect(invalid(raw => { raw.baseline.record.orientations.reverse() })).toBe(false)
    expect(invalid(raw => { raw.baseline.record.orientations[0].conflictKey = 'other' })).toBe(false)
    expect(invalid(raw => { raw.baseline.record.orientations[2].participantBuildListEntryIds.reverse() })).toBe(false)
    expect(invalid(raw => { raw.conditions.extent.maxGogmaAdvance = 300 })).toBe(false)
    expect(invalid(raw => { raw.baseline.researchMaxPlanSteps = 1000 })).toBe(false)
    expect(invalid(raw => { (raw.baseline.calculationContext as Record<string, unknown>).appSchemaVersion = 16 })).toBe(false)
  })

  it('produces no before / after from an incomparable run', () => {
    const raw = rawRun(); raw.environment.exportSha256 = '0'.repeat(64)
    const comparability = validatePhase2C26A10Comparability(raw, before)
    expect(() => comparePhase2C26A10WithC26A(comparability, before, raw.kernels, authority.orientations, identity, [])).toThrow(/not comparable/)
  })
})

describe('before -> current, semantic parity and the pre-registered decision', () => {
  const compare = (raw: ReturnType<typeof rawRun>) => comparePhase2C26A10WithC26A(validatePhase2C26A10Comparability(raw, before), before, raw.kernels, authority.orientations, identity, [])
  const decide = (raw: ReturnType<typeof rawRun>) => {
    const comparison = compare(raw)
    return phase2c26a10Decision({ orientations: raw.kernels.length, childStatus: comparison.summary.childStatus, beforeTimeout: before.timeoutOrientationIds.length, comparabilityValid: true,
      beforeCompletedRegressions: comparison.beforeCompletedRegressions.map(r => r.orientationId), semanticMismatches: comparison.semanticMismatches, preparationFailedNew: comparison.preparationFailedNew })
  }

  it('rebuilds every C2.6-A completed judgement identically (core and extended)', () => {
    const comparison = compare(rawRun())
    expect(comparison.coreSemantics).toEqual({ compared: before.completedOrientationIds.length, identical: before.completedOrientationIds.length, differing: [] })
    expect(comparison.extendedSemantics).toMatchObject({ compared: before.completedOrientationIds.length, identical: before.completedOrientationIds.length, differing: [], kernelStatusMismatches: [] })
    expect(comparison.transitions.beforeCompleted.to_completed).toEqual(before.completedOrientationIds)
    expect(comparison.transitions.beforeTimeout.to_timeout).toEqual(before.timeoutOrientationIds)
    // The rebuilt before kernels reproduce the C2.6-A Target outcome / trial / found counts.
    expect(comparison.summary.targetOutcomes).toEqual(c26aJson.kernel.targetOutcomes)
    expect(comparison.summary.trials.rejectionReasons).toEqual(c26aJson.kernel.trials.rejectionReasons)
    expect(comparison.foundBeforeAfter.current).toEqual(comparison.foundBeforeAfter.c26a)
    expect(comparison.participants).toMatchObject({ participantsSearched: c26aJson.participants.participantsSearched, c26aParticipantsSearched: c26aJson.participants.participantsSearched,
      newlySearched: [], lostSearched: [] })
  })

  it('R2: the same timeout set with no regression', () => {
    expect(decide(rawRun()).case).toBe('R2_unchanged_timeout_count')
  })

  it('R0: every orientation completed; the participants the old timeouts held become searched', () => {
    const raw = rawRun(() => 'completed')
    expect(decide(raw).case).toBe('R0_all_completed')
    const comparison = compare(raw)
    expect(comparison.transitions.beforeTimeout.to_completed).toEqual(before.timeoutOrientationIds)
    expect(comparison.participants.allParticipantsSearched).toBe(true)
    expect(comparison.participants.newlySearched).toEqual(before.participants.participantsNotSearched)
    // An old timeout's current judgement is reported, never read as "no Candidate" before.
    expect(comparison.oldTimeouts.map(r => r.transition)).toEqual(before.timeoutOrientationIds.map(() => 'timeout -> completed'))
    expect(comparison.oldTimeouts.every(r => r.current?.targets !== null)).toBe(true)
  })

  it('R1: some old timeouts completed, the rest still time out', () => {
    const keep = new Set(timeoutIds().slice(0, 2))
    expect(decide(rawRun(o => (isOldTimeout(o) && !keep.has(o.orientationId) ? 'completed' : before.view.rows.get(o.orientationId)!.outcome as Phase2C2ChildOutcome))).case).toBe('R1_improved_timeouts_remain')
  })

  it('R3: an old completed regressed even when the timeout count stays the same', () => {
    const regressed = before.completedOrientationIds[0], recovered = timeoutIds()[0]
    const raw = rawRun(o => (o.orientationId === regressed ? 'timeout' : o.orientationId === recovered ? 'completed' : before.view.rows.get(o.orientationId)!.outcome as Phase2C2ChildOutcome))
    expect(raw.kernels.filter(k => k.process.outcome === 'timeout')).toHaveLength(timeoutIds().length)
    const decision = decide(raw)
    expect(decision.case).toBe('R3_regression_or_failure')
    expect(decision.reasons.join(' ')).toMatch(new RegExp(regressed))
  })

  it('R3: OOM, process failure, more timeouts, a semantic mismatch or a new preparation failure', () => {
    const outcomeAt = (id: string, to: Phase2C2ChildOutcome) => (o: Phase2C2Orientation) => (o.orientationId === id ? to : before.view.rows.get(o.orientationId)!.outcome as Phase2C2ChildOutcome)
    expect(decide(rawRun(outcomeAt(timeoutIds()[0], 'out_of_memory'))).case).toBe('R3_regression_or_failure')
    expect(decide(rawRun(outcomeAt(timeoutIds()[0], 'process_failure'))).case).toBe('R3_regression_or_failure')
    // Core mismatch: another trial result.
    const core = rawRun()
    const coreId = before.completedOrientationIds.find(id => before.view.rows.get(id)!.targets.some(t => t.trials.length > 0))!
    const coreIndex = core.kernels.findIndex(k => k.orientationId === coreId)
    core.kernels[coreIndex] = kernelOf(core.kernels[coreIndex].task.orientation, 'completed', targets => { const t = targets.find(x => x.trials.length > 0)!; t.trials[0] = { ...t.trials[0], reason: 'other' } })
    expect(compare(core).coreSemantics.differing).toEqual([coreId])
    expect(decide(core).case).toBe('R3_regression_or_failure')
    // Extended mismatch only: another Search summary with the same outcome.
    const extended = rawRun()
    const extendedId = before.completedOrientationIds[0]
    const extendedIndex = extended.kernels.findIndex(k => k.orientationId === extendedId)
    extended.kernels[extendedIndex] = kernelOf(extended.kernels[extendedIndex].task.orientation, 'completed', targets => { targets[0].search = { ...(targets[0].search as object), excludedCandidates: 99 } })
    const extendedComparison = compare(extended)
    expect(extendedComparison.coreSemantics.differing).toEqual([])
    expect(extendedComparison.extendedSemantics.differing.map(r => r.orientationId)).toEqual([extendedId])
    expect(extendedComparison.extendedSemantics.differing[0].fields).toEqual(['targets[0].search'])
    expect(decide(extended).case).toBe('R3_regression_or_failure')
    // A completed child whose kernel only prepared-failed is a semantic mismatch for a C2.6-A completed row, and a new preparation failure.
    const prepared = rawRun()
    const preparedIndex = prepared.kernels.findIndex(k => k.orientationId === extendedId)
    ;(prepared.kernels[preparedIndex].record as unknown as { kernel: unknown }).kernel = { status: 'preparation_failed', failure: 'x', detail: 'y' }
    const preparedComparison = compare(prepared)
    expect(preparedComparison.extendedSemantics.kernelStatusMismatches).toEqual([{ orientationId: extendedId, before: 'completed', current: 'preparation_failed' }])
    expect(preparedComparison.preparationFailedNew).toEqual([extendedId])
    expect(decide(prepared).case).toBe('R3_regression_or_failure')
    expect(phase2c26a10Decision({ orientations: 3, childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 }, beforeTimeout: 2, comparabilityValid: true,
      beforeCompletedRegressions: [], semanticMismatches: [], preparationFailedNew: [] }).case).toBe('R3_regression_or_failure')
    expect(phase2c26a10Decision({ orientations: 3, childStatus: { completed: 3, out_of_memory: 0, timeout: 0, process_failure: 0 }, beforeTimeout: 2, comparabilityValid: false,
      beforeCompletedRegressions: [], semanticMismatches: [], preparationFailedNew: [] }).case).toBe('R3_regression_or_failure')
    expect(() => phase2c26a10Decision({ orientations: 4, childStatus: { completed: 3, out_of_memory: 0, timeout: 0, process_failure: 0 }, beforeTimeout: 2, comparabilityValid: true,
      beforeCompletedRegressions: [], semanticMismatches: [], preparationFailedNew: [] })).toThrow()
  })

  it('keeps the transition groups, compact rows, found summary and conclusion free of over-claims', () => {
    const raw = rawRun()
    const transitions = phase2c26a10Transitions(before.view, raw.kernels)
    expect(transitions.beforeTimeout.total).toBe(timeoutIds().length)
    expect(transitions.beforeCompleted.total).toBe(before.completedOrientationIds.length)
    const row = compactPhase2C26A10Kernel(raw.kernels[0], before.view.rows.get(raw.kernels[0].orientationId)!, identity, null)
    expect(row).not.toHaveProperty('old')
    expect(row.transition).toBe(`${before.view.rows.get(raw.kernels[0].orientationId)!.outcome} -> ${raw.kernels[0].process.outcome}`)
    expect(phase2c26a10FoundSummary([{ targetWeaponId: 'a', outcome: 'found', heldRoute: true, generatedSelected: true }, { targetWeaponId: 'a', outcome: 'found', heldRoute: false, generatedSelected: false },
      { targetWeaponId: 'b', outcome: 'stopped_by_search_extent_bound', heldRoute: null, generatedSelected: null }])).toEqual({ found: 2, distinctTargets: 1, heldRoute: { true: 1, false: 1 }, generatedSelected: { true: 1, false: 1 } })
    const conclusion = phase2c26a10Conclusion(decide(raw), { orientations: raw.kernels.length, childStatus: compare(raw).summary.childStatus, beforeChildStatus: before.childStatus })
    expect(conclusion.statement).toMatch(/current Production（C2\.6-A measured HEAD以降のA6・A9等を含むProduction全体）/)
    expect(conclusion.statement).not.toMatch(/A9によって|A9単独/)
    expect(conclusion.cannotSay.join('')).toMatch(/A9単独の効果/)
    expect(conclusion.cannotSay.join('')).toMatch(/全participantが測定可能 = Global Planが完成可能/)
    expect(PHASE2C26A10_DECISION_RULE.order.map(line => line.slice(0, 2))).toEqual(['R3', 'R0', 'R2', 'R1'])
  })

  it('extended comparison skips orientations not completed in both runs', () => {
    const raw = rawRun(o => (isOldTimeout(o) ? 'completed' : 'timeout'))
    expect(comparePhase2C26A10ExtendedSemantics(before.view, raw.kernels, identity)).toMatchObject({ compared: 0, differing: [], kernelStatusMismatches: [] })
  })
})

describe('isolation', () => {
  it('is never imported by Production and fixes no ID or count', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26A10/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [a10Source, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
      expect(source).not.toMatch(/\b54\b|\b45\b|\b43\b/)
    }
    for (const source of [a10Source, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('runs the plain C2.6-A kernel child (no profiler / observer / heartbeat) and gates every kernel behind the parity checks', () => {
    expect(runnerSource).not.toMatch(/Profiler|inspector|--cpu-prof|--no-opt|--max-inlined|heartbeat|createCountingRngEngine|instrumentation|onSearchRuntime/)
    expect(runnerSource).not.toMatch(/ORACLE|1657|optimum|runPhase2C2PortfolioContext|visitPlannerAlternativeCandidates|captureBound/)
    expect(runnerSource).not.toMatch(/plannerGlobalPhase2C26A10Analysis/)
    expect(runnerSource).toMatch(/--smoke-orientations is a non-formal smoke option and needs --allow-uncommitted/)
    const gate = runnerSource.indexOf('if (!baselineParity.valid || !conditionParity.valid || !taskSet.valid)')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(runnerSource.indexOf('await pool(tasks'))
    expect(runnerSource.indexOf('parsePhase2C26A9ResultAuthority(')).toBeLessThan(runnerSource.indexOf("runChild('baseline'"))
  })

  it('the analyzer gates the before / after on the formal run and the comparability', () => {
    const formalGate = analyzerSource.indexOf("if (!formalRunValidation.valid && !allowNonformal)")
    const comparabilityGate = analyzerSource.indexOf("if (!comparability.valid && !allowNonformal)")
    expect(formalGate).toBeGreaterThan(0)
    expect(comparabilityGate).toBeGreaterThan(formalGate)
    expect(comparabilityGate).toBeLessThan(analyzerSource.indexOf('comparePhase2C26A10WithC26A('))
    expect(comparabilityGate).toBeLessThan(analyzerSource.indexOf('writeFile('))
    expect(analyzerSource).toMatch(/const formal = formalRunValidation\.valid && comparable && calculationCodeChangedSinceMeasuredHead\.length === 0/)
    expect(analyzerSource).toMatch(/const decision = comparison === null \|\| !formalRunValidation\.valid \? null :/)
    expect(analyzerSource).not.toMatch(/visitPlannerAlternativeCandidates|createProductionPlan|ORACLE_RESULT/)
  })
})
