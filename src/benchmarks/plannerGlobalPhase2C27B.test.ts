import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import policyDocument from '../../docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c27b.mjs?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c27b-targets.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c27b.mjs?raw'
import { belowPracticalBonuses, idealBonuses, practicalBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationResetResultAt,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { hashStableValue } from '../domain/models/hashing'
import type { BuildListEntryId, RestorationBonusSet, TargetWeapon } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeFullRunBudget,
  defaultPlannerAlternativeTrialBounds,
  PlannerAlternativeRerunLimitError,
  runPlannerAlternativeKernel,
} from '../domain/planner/alternative'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import { candidateStableKey, defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { PHASE2A_RESEARCH_MAX_PLAN_STEPS } from './plannerGlobalBrowserBenchmarkRunner'
import { PHASE2C26B2C1_POLICIES, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { PHASE2C26B2C2A_REGISTERED_P1 } from './plannerGlobalPhase2C26B2C2A'
import mainSource from './plannerGlobalPhase2C27B.ts?raw'
import analysisSource from './plannerGlobalPhase2C27BAnalysis.ts?raw'
import targetsSource from './plannerGlobalPhase2C27BTargets.ts?raw'
import {
  buildPhase2C27BTargetPlans,
  createPhase2C27BLadderRerunBudget,
  createPhase2C27BTargetScheduler,
  parsePhase2C27BTargetManifest,
  PHASE2C27B_CONTEXT_SCOPE,
  PHASE2C27B_EXECUTION_ENVELOPE,
  PHASE2C27B_INITIAL_LADDER_STATE,
  PHASE2C27B_LADDER,
  PHASE2C27B_LADDER_BUDGET,
  PHASE2C27B_POLICY_AUTHORITY,
  PHASE2C27B_PROVENANCE_FLAGS,
  PHASE2C27B_REGISTERED_P1,
  PHASE2C27B_RESEARCH_MAX_PLAN_STEPS,
  phase2c27bProductionChangedFiles,
  phase2c27bRegisteredConditions,
  phase2c27bResolveSupportContext,
  phase2c27bStartAttestationBody,
  phase2c27bUnitResult,
  phase2c27bUnitTask,
  runPhase2C27BTrialLoop,
  verifyPhase2C27BStartAttestation,
  type Phase2C27BLadderState,
  type Phase2C27BScheduledUnit,
  type Phase2C27BTargetPlan,
  type Phase2C27BTargetStop,
  type Phase2C27BUnitResult,
} from './plannerGlobalPhase2C27B'
import { parsePhase2C27BPopulationAuthorities, phase2c27bPopulation, phase2c27bTargetManifest } from './plannerGlobalPhase2C27BTargets'

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')

// Captures every preflight call (the fixed constraints must always be []) and can force a refusal, as the kernel tests do.
const preflightSpy = vi.hoisted(() => ({ calls: [] as { fixedConstraints: unknown[]; conflictResolutions: number }[], refuse: 0 }))
vi.mock('../domain/planner/replacement/plannerAugmentedPreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/planner/replacement/plannerAugmentedPreflight')>()
  return {
    ...actual,
    preparePlannerReplacementConflictPreflight: (...args: Parameters<typeof actual.preparePlannerReplacementConflictPreflight>) => {
      preflightSpy.calls.push({ fixedConstraints: [...args[2]], conflictResolutions: args[0].conflictResolutions.length })
      if (preflightSpy.refuse > 0) {
        preflightSpy.refuse -= 1
        return { status: 'unresolved', conflictResolutions: [], failures: [] }
      }
      return actual.preparePlannerReplacementConflictPreflight(...args)
    },
  }
})
beforeEach(() => { preflightSpy.calls.length = 0; preflightSpy.refuse = 0 })

// ---------------------------------------------------------------- registered conditions

describe('Phase 2-C2.7-B registered conditions (Phase 2-C2.7-A §4 - §7 / §9.1)', () => {
  it('registers the Phase 2-C2.7-A document by its SHA-256 and the base main of PR #212', async () => {
    expect(await sha256(policyDocument.replace(/\r\n/g, '\n'))).toBe(PHASE2C27B_POLICY_AUTHORITY.sha256)
    expect(PHASE2C27B_POLICY_AUTHORITY.baseMain).toBe('e696ef46e1a01f18aa0bf3039463d036e412ef26')
  })

  it('uses P1 unchanged, every K <= 1 context, and never the P1 top-32 budget or K2', () => {
    expect(PHASE2C27B_REGISTERED_P1).toEqual(PHASE2C26B2C2A_REGISTERED_P1)
    expect(PHASE2C26B2C1_POLICIES.find(p => p.id === 'P1')).toEqual(PHASE2C27B_REGISTERED_P1)
    expect(PHASE2C27B_CONTEXT_SCOPE).toEqual({ maxCardinality: 1, expectedK0: 1, expectedK1: 42, expectedPerTarget: 43 })
    expect(mainSource).not.toMatch(/CONTEXT_BUDGET|\b32\b/)
  })

  it('registers the common L0 / L1 / L2 ladder, L0 being the Production default and none a Production default change', () => {
    expect(PHASE2C27B_LADDER.map(r => [r.id, { ...r.extent }])).toEqual([
      ['L0', { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }],
      ['L1', { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }],
      ['L2', { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }],
    ])
    expect({ ...PHASE2C27B_LADDER[0]!.extent }).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
  })

  it('shares the Production trial bounds 2 / 8 over the whole ladder of one (Target, context), never per rung', () => {
    expect(PHASE2C27B_LADDER_BUDGET).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8, scope: '(Target, context)', resetPerRung: false })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })

  it('runs every trial at the Research maxPlanSteps 20000, never a Production Planner option', () => {
    expect(PHASE2C27B_RESEARCH_MAX_PLAN_STEPS).toBe(20_000)
    expect(PHASE2A_RESEARCH_MAX_PLAN_STEPS).toBe(PHASE2C27B_RESEARCH_MAX_PLAN_STEPS)
    expect(codeOnly(mainSource)).not.toMatch(/conflictResolutionPlannerOptions|defaultPlannerOptions/)
  })

  it('fixes one execution envelope for every unit: 60 minutes, 12,288 MB, concurrency 1, no retry, no fallback, oracle-informed', () => {
    expect(PHASE2C27B_EXECUTION_ENVELOPE).toEqual({ unitBudgetMs: 3_600_000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none' })
    expect(PHASE2C27B_PROVENANCE_FLAGS.oracleInformedExecutionEnvelope).toBe(true)
    expect(PHASE2C27B_PROVENANCE_FLAGS.oracleGuidedTargetPopulation).toBe(true)
    expect(PHASE2C27B_PROVENANCE_FLAGS.oracleReadByScheduler).toBe(false)
    expect(PHASE2C27B_PROVENANCE_FLAGS.oracleReadBySearchChild).toBe(false)
    expect(PHASE2C27B_PROVENANCE_FLAGS.speculativeSupportWrittenAsResolution).toBe(false)
  })

  it('counts Production source changes by the registered research / test path rule', () => {
    expect(phase2c27bProductionChangedFiles(['src/benchmarks/x.ts', 'scripts/a.mjs', 'docs/a.md', 'src/domain/a.test.ts', '', 'src/test/f.ts'])).toEqual([])
    expect(phase2c27bProductionChangedFiles(['src/domain/search/bonusStream.ts', 'src/domain/search/bonusStream.ts', 'src/services/x.ts'])).toEqual(['src/domain/search/bonusStream.ts', 'src/services/x.ts'])
  })
})

// ---------------------------------------------------------------- population manifest

const authorities = async () => {
  const parsed = parsePhase2C27BPopulationAuthorities({ b2c2b1Json: JSON.parse(rawB2C2B1), b2c2b1Sha256: await sha256(rawB2C2B1), b2c1Json: JSON.parse(rawB2C1), b2c1Sha256: await sha256(rawB2C1) })
  if (!parsed.authorities) throw new Error(parsed.issues.join('; '))
  return parsed.authorities
}

describe('Phase 2-C2.7-B population (E1, Target IDs only)', () => {
  it('derives the 11 E1 Targets mechanically from the committed B2-C2B1 and B2-C1 RESULTs', async () => {
    const population = phase2c27bPopulation(await authorities())
    expect(population.valid).toBe(true)
    expect(population.targetWeaponIds).toEqual([...JSON.parse(rawB2C2B1).cohorts.e1].sort())
    expect(population.targetWeaponIds).toHaveLength(11)
  })

  it('fails closed on a foreign authority', async () => {
    expect(parsePhase2C27BPopulationAuthorities({ b2c2b1Json: JSON.parse(rawB2C2B1), b2c2b1Sha256: '0'.repeat(64), b2c1Json: JSON.parse(rawB2C1), b2c1Sha256: await sha256(rawB2C1) }).valid).toBe(false)
  })

  it('writes a manifest of Target IDs and their source provenance only, which the runner parser accepts', async () => {
    const manifest = phase2c27bTargetManifest(await authorities())
    expect(Object.keys(manifest).sort()).toEqual(['b2c1ResultSha256', 'b2c2b1ResultSha256', 'exportSha256', 'oracleGuidedTargetPopulation', 'phase', 'population', 'targetWeaponIds'])
    expect(manifest.oracleGuidedTargetPopulation).toBe(true)
    expect(parsePhase2C27BTargetManifest(JSON.parse(JSON.stringify(manifest))).valid).toBe(true)
  })

  it('refuses a manifest carrying any oracle-derived field, a wrong count, duplicates or an unsorted list', async () => {
    const manifest = JSON.parse(JSON.stringify(phase2c27bTargetManifest(await authorities())))
    for (const extra of ['oracleStableKeys', 'firstCompatibleRanks', 'requiredExtents', 'successRungs', 'expectedCandidateIndexes', 'oracleSupportRoutes', 'contextRanks']) {
      expect(parsePhase2C27BTargetManifest({ ...manifest, [extra]: [] }).valid).toBe(false)
    }
    expect(parsePhase2C27BTargetManifest({ ...manifest, targetWeaponIds: manifest.targetWeaponIds.slice(1) }).valid).toBe(false)
    expect(parsePhase2C27BTargetManifest({ ...manifest, targetWeaponIds: [...manifest.targetWeaponIds.slice(1), manifest.targetWeaponIds[1]] }).valid).toBe(false)
    expect(parsePhase2C27BTargetManifest({ ...manifest, targetWeaponIds: [...manifest.targetWeaponIds].reverse() }).valid).toBe(false)
    expect(parsePhase2C27BTargetManifest({ ...manifest, oracleGuidedTargetPopulation: false }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- oracle isolation

const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** The benchmark files reachable from one benchmark module through relative imports (Production imports are not followed). */
function benchmarkClosure(entry: string): string[] {
  const seen = new Set<string>(), stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = benchmarkSources[file]
    if (source === undefined) throw new Error(`no source for ${file}`)
    for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.\/[^']+)'/g)) stack.push(`${match[1]}.ts`)
  }
  return [...seen].sort()
}
const codeOnly = (source: string) => source.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')

describe('Phase 2-C2.7-B oracle isolation (§2.4 / G2)', () => {
  it('lets the scheduler / unit module reach no oracle, analysis or population-authority module', () => {
    const closure = benchmarkClosure('./plannerGlobalPhase2C27B.ts')
    expect(closure).toContain('./plannerGlobalPhase2C26B2C1.ts')
    expect(closure.filter(f => /Oracle|Analysis|Targets|Interpretation|FormalValidation|LowerBound/.test(f))).toEqual([])
    for (const file of closure) expect(codeOnly(benchmarkSources[file]!)).not.toMatch(/ORACLE_[1]657|_RESULT\.json|readFile|node:fs/)
  })

  it('keeps the runner on oracle-free modules only and gives the child nothing but the unit task', () => {
    const loaded = [...runnerSource.matchAll(/ssrLoadModule\('([^']+)'\)/g)].map(m => m[1]).sort()
    expect(loaded).toEqual(['/src/benchmarks/plannerGlobalOptimizationResearch.ts', '/src/benchmarks/plannerGlobalPhase2C26A.ts', '/src/benchmarks/plannerGlobalPhase2C26B2C1.ts',
      '/src/benchmarks/plannerGlobalPhase2C27B.ts', '/src/domain/rng/production/productionRngEngine.ts'])
    expect(codeOnly(runnerSource)).not.toMatch(/Oracle1657|ORACLE_|oracleRoute|oracleKey|_RESULT|Analysis|Targets\.ts|--b2c2b1|--b2c1|--manifest|stableKey/)
    expect(benchmarkClosure('./plannerGlobalPhase2C26A.ts').filter(f => /Oracle|Analysis|Targets/.test(f))).toEqual([])
    expect(benchmarkClosure('./plannerGlobalOptimizationResearch.ts').filter(f => /Oracle|Analysis|Targets/.test(f))).toEqual([])
    // Only the analyzer reads the oracle.
    expect(analyzerSource).toMatch(/materializeOracleRoutes/)
    expect(codeOnly(prepareSource)).not.toMatch(/--oracle|--manifest|Oracle1657|visitPlannerAlternativeCandidates/)
  })

  it('hard-codes no Target, Entry, digest or stable key of the population anywhere in the Phase 2-C2.7-B code', () => {
    const e1: string[] = JSON.parse(rawB2C2B1).cohorts.e1
    for (const source of [mainSource, targetsSource, analysisSource, runnerSource, prepareSource, analyzerSource]) {
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|fnv1a32[-:][0-9a-f]{8}|build-list\./)
      for (const id of e1) expect(source).not.toContain(id.slice(0, 8))
    }
    expect(codeOnly(mainSource)).not.toMatch(/firstCompatible|requiredExtent|firstLadderRung|exactIndex|oracleStableKey/)
  })

  it('is never imported by Production', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C27B/.test(source)).map(([path]) => path)).toEqual([])
  })
})

// ---------------------------------------------------------------- contexts (synthetic schedule)

function syntheticSchedule(options: { targets?: { id: string; checkpoint?: boolean }[]; k1?: number; k2?: number; breakRank?: boolean } = {}): Phase2C26B2C1Schedule {
  const targets = options.targets ?? [{ id: 'target.a' }]
  const k1 = options.k1 ?? 42, k2 = options.k2 ?? 3
  const groups = [{ groupIndex: 0, reservationDigest: 'g0', reservation: { normal: [], skill: null, gogma: null, exclusiveOwnedWeaponIds: [] }, aliasFixedSetIds: ['K0'], minCardinality: 0 }]
  const fixedSets = [{ fixedSetId: 'K0', cardinality: 0, fixedBuildListEntryIds: [], fixedTargetWeaponIds: [], valid: true, reservationGroupIndex: 0 }]
  for (let i = 1; i <= k1 + k2; i += 1) {
    const ids = i <= k1 ? [`entry.s${i}`] : [`entry.s${i}`, `entry.t${i}`]
    const reservation = { normal: [], skill: { held: [i], blocked: [] }, gogma: null, exclusiveOwnedWeaponIds: [] }
    groups.push({ groupIndex: i, reservationDigest: '', reservation, aliasFixedSetIds: [`F${i}`], minCardinality: ids.length } as never)
    fixedSets.push({ fixedSetId: `F${i}`, cardinality: ids.length, fixedBuildListEntryIds: ids, fixedTargetWeaponIds: ids.map(x => `target.${x}`), valid: true, reservationGroupIndex: i } as never)
  }
  return { snapshot: { fixedSets, reservationGroups: groups, targets: [], originDigest: 'o' } as never, extent: { ...defaultPlannerAlternativeSearchExtent }, origins: { skill: 0, gogma: 0 },
    policies: PHASE2C26B2C1_POLICIES,
    targets: targets.map(t => ({ targetWeaponId: t.id, currentBuildListEntryId: `entry.own.${t.id}`, checkpointHardConstraint: t.checkpoint ?? false, originSemanticDigest: '', relevantNormalCounterId: null, windows: null as never, contexts: 0 })),
    contexts: targets.flatMap(t => t.checkpoint ? [] : groups.map((g, i) => ({ targetWeaponId: t.id, groupIndex: g.groupIndex, reservationDigest: g.reservationDigest,
      targetEligibleMinCardinality: g.minCardinality as never, representativeFixedSetId: g.aliasFixedSetIds[0]!, representativeFixedTargetWeaponIds: [], eligibleAliasCount: 1, features: null as never,
      ranks: { P0: i + 1, P1: options.breakRank && i === 2 ? 99 : i + 1, P2: i + 1, P3: i + 1 } }))),
    checks: null as never }
}
// Fill the digests the plan builder recomputes (hashStableValue of the reservation).
function withDigests(schedule: Phase2C26B2C1Schedule): Phase2C26B2C1Schedule {
  schedule.snapshot.reservationGroups.forEach(g => { g.reservationDigest = hashStableValue(g.reservation) })
  schedule.contexts.forEach(c => { c.reservationDigest = schedule.snapshot.reservationGroups[c.groupIndex]!.reservationDigest })
  return schedule
}

describe('Phase 2-C2.7-B K <= 1 contexts in P1 order', () => {
  it('takes exactly the K0 + K1 prefix of P1 (rank 1 .. 43), with the representative support set of each group', () => {
    const built = buildPhase2C27BTargetPlans(withDigests(syntheticSchedule()), ['target.a'])
    expect(built.valid).toBe(true)
    const plan = built.plans[0]!
    expect(plan.contexts.map(c => c.contextRank)).toEqual(Array.from({ length: 43 }, (_, i) => i + 1))
    expect(plan.contexts[0]).toMatchObject({ cardinality: 0, supportBuildListEntryIds: [], representativeFixedSetId: 'K0' })
    expect(plan.contexts[5]).toMatchObject({ cardinality: 1, supportBuildListEntryIds: ['entry.s5'] })
    expect(plan.contexts.every(c => c.cardinality <= 1)).toBe(true)
  })

  it('stops a checkpoint hard-constraint Target without any context', () => {
    const built = buildPhase2C27BTargetPlans(withDigests(syntheticSchedule({ targets: [{ id: 'target.a' }, { id: 'target.c', checkpoint: true }] })), ['target.a', 'target.c'])
    expect(built.valid).toBe(true)
    expect(built.plans[1]).toMatchObject({ checkpointBlocked: true, contexts: [] })
  })

  it('fails closed on a K1 count other than the registered one, a broken rank prefix, a digest drift or a support set holding the own Entry', () => {
    expect(buildPhase2C27BTargetPlans(withDigests(syntheticSchedule({ k1: 41 })), ['target.a']).valid).toBe(false)
    expect(buildPhase2C27BTargetPlans(withDigests(syntheticSchedule({ breakRank: true })), ['target.a']).valid).toBe(false)
    const drift = withDigests(syntheticSchedule())
    drift.contexts[3]!.reservationDigest = 'other'
    expect(buildPhase2C27BTargetPlans(drift, ['target.a']).valid).toBe(false)
    const own = withDigests(syntheticSchedule())
    ;(own.snapshot.fixedSets[4] as { fixedBuildListEntryIds: string[] }).fixedBuildListEntryIds = ['entry.own.target.a']
    expect(buildPhase2C27BTargetPlans(own, ['target.a']).valid).toBe(false)
    expect(buildPhase2C27BTargetPlans(withDigests(syntheticSchedule()), ['target.missing']).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- the rung-major scheduler

function plan(ranks: number, options: { checkpointBlocked?: boolean } = {}): Phase2C27BTargetPlan {
  return { targetWeaponId: 'target.a', targetIndex: 3, currentBuildListEntryId: 'entry.own', checkpointBlocked: options.checkpointBlocked ?? false,
    contexts: Array.from({ length: ranks }, (_, i) => ({ targetWeaponId: 'target.a', contextRank: i + 1, groupIndex: i, reservationDigest: `d${i}`, cardinality: (i === 0 ? 0 : 1) as 0 | 1,
      representativeFixedSetId: i === 0 ? 'K0' : `F${i}`, supportBuildListEntryIds: i === 0 ? [] : [`entry.s${i}`], supportTargetWeaponIds: [] })) }
}
const state = (t: number, r: number, keys: string[] = []): Phase2C27BLadderState => ({ candidateTrialsUsed: t, plannerRerunsUsed: r, previouslyRejectedCandidateStableKeys: keys })
const measured = (outcome: Extract<Phase2C27BUnitResult, { measured: true }>['outcome'], end: Phase2C27BLadderState = state(0, 0)): Phase2C27BUnitResult => ({ measured: true, outcome, ladderStateAtEnd: end })

/** Drives one scheduler with a result function and returns the unit sequence and the stop. */
function drive(p: Phase2C27BTargetPlan, resultOf: (unit: Phase2C27BScheduledUnit) => Phase2C27BUnitResult) {
  const scheduler = createPhase2C27BTargetScheduler(p)
  const units: Phase2C27BScheduledUnit[] = []
  for (let i = 0; i < 1000; i += 1) {
    const next = scheduler.next()
    if (!('unitId' in next)) return { units, stop: next as Phase2C27BTargetStop, states: scheduler.contextStates() }
    units.push(next)
    scheduler.record(resultOf(next))
  }
  throw new Error('no stop')
}

describe('Phase 2-C2.7-B rung-major scheduler (§6.2)', () => {
  it('runs every context at L0 in P1 order, escalates only the extent-bound ones, and stops with ladder_exhausted after L2', () => {
    const run = drive(plan(4), u => measured(u.contextRank === 2 ? 'not_found_within_search_extent' : 'stopped_by_search_extent_bound'))
    expect(run.units.map(u => u.unitId)).toEqual(['t03-r01-L0', 't03-r02-L0', 't03-r03-L0', 't03-r04-L0', 't03-r01-L1', 't03-r03-L1', 't03-r04-L1', 't03-r01-L2', 't03-r03-L2', 't03-r04-L2'])
    expect(run.stop).toEqual({ stopReason: 'ladder_exhausted', rung: 'L2', contextRank: null })
  })

  it('never escalates a trial-bound, rerun-bound or unmeasured context, and stops when no extent-bound context is left', () => {
    const outcomes: Record<number, Phase2C27BUnitResult> = { 1: measured('stopped_by_candidate_trial_bound', state(2, 2)), 2: measured('stopped_by_planner_rerun_bound', state(1, 8)),
      3: { measured: false, reason: 'timeout' }, 4: { measured: false, reason: 'out_of_memory' }, 5: measured('not_found_within_search_extent') }
    const run = drive(plan(5), u => outcomes[u.contextRank]!)
    expect(run.units.map(u => u.unitId)).toEqual(['t03-r01-L0', 't03-r02-L0', 't03-r03-L0', 't03-r04-L0', 't03-r05-L0'])
    expect(run.stop).toEqual({ stopReason: 'no_extent_escalation_context', rung: 'L0', contextRank: null })
    expect(run.states.map(s => s.state)).toEqual(['candidate_trial_bound_reached', 'planner_rerun_bound_reached', 'unmeasured', 'unmeasured', 'closed'])
  })

  it('stops the Target at the first found_R, at any rung and context', () => {
    const run = drive(plan(4), u => u.rung === 'L1' && u.contextRank === 3 ? measured('found_R', state(1, 1)) : measured('stopped_by_search_extent_bound'))
    expect(run.units.map(u => u.unitId)).toEqual(['t03-r01-L0', 't03-r02-L0', 't03-r03-L0', 't03-r04-L0', 't03-r01-L1', 't03-r02-L1', 't03-r03-L1'])
    expect(run.stop).toEqual({ stopReason: 'found_R', rung: 'L1', contextRank: 3 })
  })

  it('carries the end ladder state of a rung into the next rung of the same context, never refilling it', () => {
    const run = drive(plan(2), u => u.rung === 'L0' ? measured('stopped_by_search_extent_bound', state(u.contextRank, 1, [`key.${u.contextRank}`])) : u.rung === 'L1'
      ? measured('stopped_by_search_extent_bound', state(2, 3, [`key.${u.contextRank}`, 'key.b'])) : measured('not_found_within_search_extent', state(2, 3)))
    expect(run.units.map(u => [u.unitId, u.ladderStateAtStart])).toEqual([
      ['t03-r01-L0', state(0, 0)], ['t03-r02-L0', state(0, 0)],
      ['t03-r01-L1', state(1, 1, ['key.1'])], ['t03-r02-L1', state(2, 1, ['key.2'])],
      ['t03-r01-L2', state(2, 3, ['key.1', 'key.b'])], ['t03-r02-L2', state(2, 3, ['key.2', 'key.b'])],
    ])
  })

  it('runs no unit at all for a checkpoint-blocked Target', () => {
    const run = drive(plan(0, { checkpointBlocked: true }), () => { throw new Error('a unit ran') })
    expect(run.units).toEqual([])
    expect(run.stop).toEqual({ stopReason: 'blocked_by_selected_checkpoint', rung: null, contextRank: null })
  })

  it('refuses to schedule before the pending unit is recorded', () => {
    const scheduler = createPhase2C27BTargetScheduler(plan(2))
    scheduler.next()
    expect(() => scheduler.next()).toThrow('no recorded result')
  })

  it('reads a timeout / OOM / failure / context mismatch as unmeasured, never as a Search outcome', () => {
    expect(phase2c27bUnitResult('timeout', null)).toEqual({ measured: false, reason: 'timeout' })
    expect(phase2c27bUnitResult('out_of_memory', null)).toEqual({ measured: false, reason: 'out_of_memory' })
    expect(phase2c27bUnitResult('completed', null)).toEqual({ measured: false, reason: 'process_failure' })
    expect(phase2c27bUnitResult('completed', { status: 'context_mismatch', unitId: 'u', issues: [] })).toEqual({ measured: false, reason: 'context_mismatch' })
    expect(phase2c27bUnitResult('interrupted', null)).toEqual({ measured: false, reason: 'interrupted' })
  })

  it('builds the unit task from the plan and the scheduled unit only (no oracle field)', () => {
    const p = plan(3)
    const task = phase2c27bUnitTask(p, { unitId: 't03-r02-L1', targetWeaponId: 'target.a', targetIndex: 3, contextRank: 2, rung: 'L1', ladderStateAtStart: state(1, 2, ['k']) })
    expect(Object.keys(task).sort()).toEqual(['budget', 'cardinality', 'contextRank', 'currentBuildListEntryId', 'extent', 'groupIndex', 'ladderStateAtStart', 'representativeFixedSetId',
      'researchMaxPlanSteps', 'reservationDigest', 'rung', 'supportBuildListEntryIds', 'targetIndex', 'targetWeaponId', 'unitId'])
    expect(task.extent).toEqual({ maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 })
    expect(task.ladderStateAtStart).toEqual(state(1, 2, ['k']))
  })
})

// ---------------------------------------------------------------- the ladder rerun budget

describe('Phase 2-C2.7-B cumulative rerun budget', () => {
  it('behaves exactly as the Production budget from zero, and resumes from the runs a lower rung used', () => {
    const production = createPlannerAlternativeFullRunBudget({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
    const research = createPhase2C27BLadderRerunBudget(8, 0)
    for (let i = 0; i < 8; i += 1) { production.beforePlannerRun(); research.beforePlannerRun() }
    expect([research.used, research.exhausted]).toEqual([production.used, production.exhausted])
    expect(() => production.beforePlannerRun()).toThrow(PlannerAlternativeRerunLimitError)
    expect(() => research.beforePlannerRun()).toThrow(PlannerAlternativeRerunLimitError)
    const resumed = createPhase2C27BLadderRerunBudget(8, 7)
    resumed.beforePlannerRun()
    expect(resumed.exhausted).toBe(true)
    expect(() => resumed.beforePlannerRun()).toThrow(PlannerAlternativeRerunLimitError)
    expect(() => createPhase2C27BLadderRerunBudget(8, 9)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------- the unit trial loop (Fake RNG Engine fixtures)

const TARGET_A = 'target.c27b.a', TARGET_B = 'target.c27b.b', TARGET_C = 'target.c27b.c'
const ENTRY_A = 'build-list.c27b.a' as BuildListEntryId, ENTRY_B = 'build-list.c27b.b' as BuildListEntryId, ENTRY_C = 'build-list.c27b.c' as BuildListEntryId
const SOURCE_C = 'owned.c27b.c'
const SKILL_A = 'series_skill.fixture.z', SKILL_B = 'series_skill.fixture.b-source', SKILL_C = 'series_skill.fixture.c-source'
const ownSkill = (id: string, seriesSkillId: string, priority: TargetWeapon['priority']) => {
  const skill = { seriesSkillId, groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(id, { priority, idealSkillCondition: skill, practicalSkillCondition: skill })
}

/** A and B contend for Gogma 10; B's alternatives skip the held 10 when A's Route is the support (the kernel fixture). */
function fixture(options: { withC?: boolean; resetResultAt?: (gogmaCounter: number) => RestorationBonusSet } = {}): OrchestrationScenario {
  const a = ownSkill(TARGET_A, SKILL_A, 5), b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  const targets = [a, b], ownedWeapons = [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SKILL_A }),
    orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SKILL_B })]
  const entries = [orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SKILL_A }),
    orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] })]
  if (options.withC) {
    const c = ownSkill(TARGET_C, SKILL_C, 4)
    targets.push(c)
    ownedWeapons.push(orchestrationSource(SOURCE_C, { seriesSkillId: SKILL_C }))
    entries.push(orchestrationEntry(ENTRY_C, c, { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: resetRoute(SOURCE_C).sourceOwnedWeaponId,
      operations: [...resetRoute(SOURCE_C, 11).operations, ...resetRoute(SOURCE_C, 12).operations] }, { seriesSkillId: SKILL_C }))
  }
  return orchestrationScenario({ targets, ownedWeapons, entries, engine: options.resetResultAt ? { resetResultAt: options.resetResultAt } : undefined })
}
const twoIdeals = (gogmaCounter: number) => gogmaCounter === 14 ? idealBonuses() : orchestrationResetResultAt(gogmaCounter)
const EXTENT = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }
async function loop(built: OrchestrationScenario, support: string[], ladder: Phase2C27BLadderState = PHASE2C27B_INITIAL_LADDER_STATE, extent = EXTENT) {
  const resolved = phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, support)
  if (resolved.status !== 'ready') throw new Error(resolved.issues.join('; '))
  return runPhase2C27BTrialLoop(built.input, resolved.prepared, extent, ladder, built.dependencies)
}

describe('Phase 2-C2.7-B unit trial loop and found_R (§6.4)', () => {
  it('reproduces the Production kernel found Candidate and G when the support is the fixed Route, without any resolution', async () => {
    const kernelBuilt = fixture()
    const prepared = preparePlannerInitialContext(kernelBuilt.input, kernelBuilt.dependencies)
    if (prepared.status !== 'ready') throw new Error('fixture')
    const conflict = prepared.context.initialConflictDetection.conflicts.find(c => c.kind === 'same_gogma_counter' && c.buildListEntryIds.includes(ENTRY_A))!
    const kernel = await runPlannerAlternativeKernel({ plannerInput: kernelBuilt.input, decision: { conflictKey: conflict.id, selectedBuildListEntryId: ENTRY_A }, priorFixedBuildListEntryIds: [],
      priorExcludedRoutes: [], extent: EXTENT, bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 } }, kernelBuilt.dependencies)
    if (kernel.status !== 'completed' || kernel.targets[0]!.outcome.status !== 'found') throw new Error('kernel fixture')
    const kernelFound = kernel.targets[0]!.outcome

    preflightSpy.calls.length = 0
    const built = fixture()
    const before = structuredClone(built.input)
    const result = await loop(built, [ENTRY_A])
    expect(result.outcome).toBe('found_R')
    expect(result.found?.candidateStableKey).toBe(candidateStableKey(kernelFound.candidate))
    expect(result.found?.generatedBuildListEntryId).toBe(kernelFound.generated.entry.id)
    expect(result.found?.generatedSelected).toBe(kernelFound.generatedSelected)
    expect(result.reservation).toEqual(kernel.targets[0]!.reservation)
    expect(result.ladderStateAtEnd).toEqual(state(1, 1))
    expect(result.trials[0]!.trialConflictResolutions).toBe(0)
    // G1: no fixed constraint, no resolution reaches any trial; the baseline input is untouched.
    expect(preflightSpy.calls.map(c => [c.fixedConstraints.length, c.conflictResolutions])).toEqual([[0, 0]])
    expect(built.input).toEqual(before)
    expect(built.input.conflictResolutions).toEqual([])
  })

  it('finds a K0 (empty support) G that only loses a provisional outcome to an Entry outside the support set', async () => {
    const result = await loop(fixture({ withC: true }), [])
    expect(result.reservation).toEqual({ normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] })
    expect(result.outcome).toBe('found_R')
    const trial = result.trials.at(-1)!
    expect(trial.verdict.status).toBe('found_R')
    if (trial.verdict.status === 'found_R' && !trial.verdict.generatedSelected) {
      expect(trial.run?.generatedCommitment?.status).toBe('dropped')
      expect(trial.run?.generatedCommitment?.rejectionReasons.every(r => r === 'conflict_not_committed')).toBe(true)
    }
  })

  it('skips a Candidate rejected at a lower rung without budget, trialling only new Candidates at the upper rung', async () => {
    preflightSpy.refuse = 1
    const lower = await loop(fixture({ resetResultAt: twoIdeals }), [ENTRY_A], PHASE2C27B_INITIAL_LADDER_STATE, { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 })
    expect(lower.trials[0]!.verdict).toEqual({ status: 'rejected', reason: 'preflight_refused' })
    const rejectedKey = lower.trials[0]!.candidateStableKey
    expect(lower.ladderStateAtEnd.previouslyRejectedCandidateStableKeys[0]).toBe(rejectedKey)
    // The ladder state after that one rejected trial, carried to a larger extent (a fresh child, as a unit is).
    const upper = await loop(fixture({ resetResultAt: twoIdeals }), [ENTRY_A], state(1, 0, [rejectedKey]), { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 })
    expect(upper.skippedPreviouslyRejected).toEqual([rejectedKey])
    expect(upper.deliveries.find(d => d.stableKey === rejectedKey)?.action).toBe('skipped_previously_rejected')
    expect(upper.trials.map(t => t.candidateStableKey)).not.toContain(rejectedKey)
    expect(upper.trials[0]!.trialOrdinal).toBe(1)
    expect(upper.ladderStateAtEnd.candidateTrialsUsed).toBe(1 + upper.trials.length)
    expect(upper.ladderStateAtEnd.previouslyRejectedCandidateStableKeys[0]).toBe(rejectedKey)
  })

  it('stops on the cumulative trial bound at the first new Candidate once 2 trials were used on lower rungs', async () => {
    const result = await loop(fixture(), [ENTRY_A], state(2, 2, ['k.1', 'k.2']))
    expect(result.outcome).toBe('stopped_by_candidate_trial_bound')
    expect(result.trials).toEqual([])
    expect(result.deliveries.at(-1)!.action).toBe('stopped_by_candidate_trial_bound')
    expect(result.ladderStateAtEnd).toEqual(state(2, 2, ['k.1', 'k.2']))
  })

  it('stops on the cumulative rerun bound without starting a full run once 8 runs were used on lower rungs', async () => {
    const result = await loop(fixture(), [ENTRY_A], state(1, 8, ['k.1']))
    expect(result.outcome).toBe('stopped_by_planner_rerun_bound')
    expect(result.trials).toEqual([])
    expect(preflightSpy.calls).toEqual([])
    expect(result.ladderStateAtEnd).toEqual(state(1, 8, ['k.1']))
    const last = await loop(fixture(), [ENTRY_A], state(1, 7, ['k.1']))
    expect(last.outcome).toBe('found_R')
    expect(last.ladderStateAtEnd).toEqual(state(2, 8, ['k.1']))
  })

  it('separates an extent stop from an exhausted Search', async () => {
    const noIdeal = (gogmaCounter: number) => (gogmaCounter === 10 ? idealBonuses() : practicalBonuses())
    const result = await loop(fixture({ resetResultAt: noIdeal }), [ENTRY_A], PHASE2C27B_INITIAL_LADDER_STATE, { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 })
    expect(result.outcome).toBe('stopped_by_search_extent_bound')
    expect(result.search.stoppedByExtent).toBe(true)
    expect(result.trials).toEqual([])
  })

  it('fails closed on a support set holding the own Entry, an unknown support Entry, or a baseline resolution', () => {
    const built = fixture()
    expect(phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, [ENTRY_B]).status).toBe('invalid')
    expect(phase2c27bResolveSupportContext(built.input, built.dependencies, TARGET_B, ['build-list.unknown']).status).toBe('invalid')
    expect(phase2c27bResolveSupportContext({ ...built.input, conflictResolutions: [{ conflictKey: 'c', selectedBuildListEntryId: ENTRY_A }] }, built.dependencies, TARGET_B, []).status).toBe('invalid')
  })

  it('writes no resolution, scenario resolution, lineage or selected Entry for a support Entry anywhere in its code (G1)', () => {
    expect(codeOnly(mainSource)).not.toMatch(/scenarioResolution|conflictRepairLineage|selectedBuildListEntryId:|conflictResolutions: \[\{|runPlannerAlternativeKernel|preparePlannerAlternativeKernel|mergePlannerConflictScenarioResolution/)
    expect(codeOnly(mainSource)).toMatch(/preparePlannerReplacementConflictPreflight\(\{ \.\.\.input, buildListEntries: \[\.\.\.input\.buildListEntries, generated\.entry\] \}, replacements, \[\], conflictContexts, dependencies\)/)
    expect(codeOnly(mainSource)).toMatch(/explicitDecisionBuildListEntryIds: support as BuildListEntryId\[\],\s*fixedRouteBuildListEntryIds: support as BuildListEntryId\[\]/)
    expect(codeOnly(mainSource)).toMatch(/status: 'found_R'/)
  })
})

// ---------------------------------------------------------------- start attestation

const observation = () => ({ createdAt: '2026-10-07T00:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c27b.mjs', node: 'v24', repositoryHead: 'a'.repeat(40),
  uncommittedBenchmarkCode: false, benchmarkCodeSha256: 'b'.repeat(64), policyDocumentSha256: PHASE2C27B_POLICY_AUTHORITY.sha256, exportFileName: 'x.json',
  exportSha256: 'e'.repeat(64), exportBytes: 1, targetManifestFileName: 'm', targetManifestSha256: 'c'.repeat(64),
  targetWeaponIds: ['t1'], productionAudit: { baseMain: PHASE2C27B_POLICY_AUTHORITY.baseMain, baseMainIsAncestor: true, productionChangedSinceBaseMain: [] },
  machine: { freeMemoryBytes: 1, totalMemoryBytes: 2, otherNodeProcesses: 0, cpuBusyShare: 0 }, appliedExecutionEnvelope: { ...PHASE2C27B_EXECUTION_ENVELOPE }, smoke: null })
const expectation = { repositoryHead: 'a'.repeat(40), benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'e'.repeat(64),
  targetManifestSha256: 'c'.repeat(64), targetWeaponIds: ['t1'], firstChildStartedAt: '2026-10-07T00:00:01.000Z' }

describe('Phase 2-C2.7-B start attestation', () => {
  it('verifies a clean formal launch with every registered condition', () => {
    const body = JSON.parse(JSON.stringify(phase2c27bStartAttestationBody(observation())))
    expect(verifyPhase2C27BStartAttestation(body, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    expect(body.ladderBudget).toEqual({ ...PHASE2C27B_LADDER_BUDGET })
    expect(body.executionEnvelope).toEqual({ ...PHASE2C27B_EXECUTION_ENVELOPE })
    expect(phase2c27bRegisteredConditions().decisionRule).toHaveLength(5)
  })

  it('fails on Production changes, a smoke or uncommitted launch, a changed condition, a later attestation or a foreign input', () => {
    const verify = (patch: object, exp = expectation) => verifyPhase2C27BStartAttestation(JSON.parse(JSON.stringify({ ...phase2c27bStartAttestationBody(observation()), ...patch })), exp)
    expect(verify({ productionAudit: { baseMain: PHASE2C27B_POLICY_AUTHORITY.baseMain, baseMainIsAncestor: true, productionChangedSinceBaseMain: ['src/domain/x.ts'] } }).verified).toBe(false)
    expect(verify({ smoke: { targetIndexes: [0], maxUnits: 1, unitBudgetMs: null } }).verified).toBe(false)
    expect(verify({ uncommittedBenchmarkCode: true }).verified).toBe(false)
    expect(verify({ appliedExecutionEnvelope: { ...PHASE2C27B_EXECUTION_ENVELOPE, unitBudgetMs: 60_000 } }).verified).toBe(false)
    expect(verify({ ladder: [] }).verified).toBe(false)
    expect(verify({ ladderBudget: { ...PHASE2C27B_LADDER_BUDGET, resetPerRung: true } }).verified).toBe(false)
    expect(verify({ policyDocumentSha256: '0'.repeat(64) }).integrityIssues.length).toBeGreaterThan(0)
    expect(verify({}, { ...expectation, firstChildStartedAt: '2026-10-06T00:00:00.000Z' }).integrityIssues).toContain('createdAt is later than the first child start')
    expect(verify({}, { ...expectation, repositoryHead: 'f'.repeat(40) }).integrityIssues).toContain('repositoryHead differs')
    expect(verify({ extra: 1 }).integrityIssues).toContain('the start attestation keys are not exactly the attestation keys')
  })
})
