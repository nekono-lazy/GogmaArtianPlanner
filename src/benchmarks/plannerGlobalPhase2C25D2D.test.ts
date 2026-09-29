import { describe, expect, it } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import d2aResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json'
import d2cResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2C_RESULT.json'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search/alternative/plannerAlternativeTypes'
import { parsePhase2C25CEvidence, selectPhase2C25CWorkload } from './plannerGlobalPhase2C25C'
import { PHASE2C25A_RUN_BUDGET_MS } from './plannerGlobalPhase2C25A'
import type { Phase2C25D2AAfter, Phase2C25D2ARawMode } from './plannerGlobalPhase2C25D2A'
import { parsePhase2C25D2CD2AResult, selectPhase2C25D2CWorkload } from './plannerGlobalPhase2C25D2C'
import {
  analyzePhase2C25D2DRun,
  assertPhase2C25D2DWorkloadMatchesD2C,
  auditPhase2C25D2DBonusStreamSource,
  parsePhase2C25D2DD2ABefore,
  parsePhase2C25D2DD2CResult,
  phase2c25d2dItemKey,
  phase2c25d2dPrimaryOutcome,
  phase2c25d2dWorkloadItems,
  PHASE2C25D2D_CANDIDATE_STOP_BOUND,
  PHASE2C25D2D_CHILD_HEAP_MB,
  PHASE2C25D2D_CONCURRENCY,
  PHASE2C25D2D_MODES,
  PHASE2C25D2D_RUN_BUDGET_MS,
} from './plannerGlobalPhase2C25D2D'
import d2dSource from './plannerGlobalPhase2C25D2D.ts?raw'
import { validatePhase2C25D2DFormalRun } from './plannerGlobalPhase2C25D2DFormalValidation'
import formalValidationSource from './plannerGlobalPhase2C25D2DFormalValidation.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c25d2d.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c25d2d.mjs?raw'

const workload = selectPhase2C25D2CWorkload(parsePhase2C25D2CD2AResult(d2aResult), selectPhase2C25CWorkload(parsePhase2C25CEvidence(c25aEvidence)))
const items = phase2c25d2dWorkloadItems(workload)

describe('conditions', () => {
  it('keeps the D2-a Search-only conditions and the C2.5-A run budget', () => {
    expect(PHASE2C25D2D_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C25D2D_CONCURRENCY).toBe(1)
    expect(PHASE2C25D2D_CANDIDATE_STOP_BOUND).toBe(1)
    expect(PHASE2C25D2D_RUN_BUDGET_MS).toBe(PHASE2C25A_RUN_BUDGET_MS)
    expect(PHASE2C25D2D_RUN_BUDGET_MS).toBe(20 * 60 * 1000)
    expect([...PHASE2C25D2D_MODES]).toEqual(['minimal', 'instrumented'])
  })

  it('changes no Production default or version', () => {
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})

describe('workload (the D2-c rule over the committed D2-a RESULT)', () => {
  it('selects the two primary OOM contexts, the cleared reference and the two controls', () => {
    expect(items.map(item => `${phase2c25d2dItemKey(item)}:${item.role}`)).toEqual([
      'c12-p0#0:primary_oom', 'c2-p1#0:primary_oom', 'c0-p0#0:cleared_reference',
      'c8-p1#0:control_first_candidate', 'c13-p4#0:control_stopped_by_extent',
    ])
  })

  it('equals the D2-c RESULT workload and fails closed on any difference', () => {
    const d2c = parsePhase2C25D2DD2CResult(d2cResult)
    expect(() => assertPhase2C25D2DWorkloadMatchesD2C(workload, d2c.items)).not.toThrow()
    expect(() => assertPhase2C25D2DWorkloadMatchesD2C(workload, d2c.items.slice(1))).toThrow(/differs from the D2-c/)
    const swapped = d2c.items.map((item, i) => (i === 0 ? { ...item, contextDigest: 'fnv1a32:00000000' } : item))
    expect(() => assertPhase2C25D2DWorkloadMatchesD2C(workload, swapped)).toThrow(/differs from the D2-c/)
  })

  it('reads the D2-c jit_default sampling runs as a reference per context', () => {
    const { references } = parsePhase2C25D2DD2CResult(d2cResult)
    const c12 = references.get('c12-p0#0')!
    expect(c12.outcome).toBe('out_of_memory')
    expect(c12.lastProgress?.maxDepth.gogma).toBe(12)
    expect(c12.lastProgress?.cumulative.gogmaGeneratedStates).toBe(17403169)
    expect([...references.keys()].sort()).toEqual(items.map(phase2c25d2dItemKey).sort())
  })

  it('fails closed on a non-formal RESULT', () => {
    expect(() => parsePhase2C25D2DD2CResult({ ...d2cResult, provenance: { ...d2cResult.provenance, formal: false } })).toThrow(/formal/)
    expect(() => parsePhase2C25D2DD2ABefore({ ...d2aResult, provenance: { ...d2aResult.provenance, formal: false } }, items)).toThrow(/formal/)
  })
})

describe('the D2-a before view', () => {
  const before = parsePhase2C25D2DD2ABefore(d2aResult, items)

  it('reads both modes of every selected context', () => {
    expect(before.get('c12-p0#0')!.minimal.view.status).toBe('out_of_memory')
    expect(before.get('c12-p0#0')!.instrumented.metrics?.gogmaMaxDepth).toBe(12)
    expect(before.get('c0-p0#0')!.instrumented.view.status).toBe('stopped_by_extent_before_candidate')
    expect(before.get('c8-p1#0')!.minimal.view.status).toBe('first_candidate')
  })

  it('fails closed when the D2-a index names another context', () => {
    expect(() => parsePhase2C25D2DD2ABefore(d2aResult, [{ ...items[0], d2aIndex: items[1].d2aIndex }])).toThrow(/is not c12-p0#0/)
  })
})

describe('primary outcome', () => {
  it('states what a primary context reached: a timeout left OOM but did not end normally', () => {
    expect(phase2c25d2dPrimaryOutcome('out_of_memory', 'out_of_memory')).toEqual({ leftOom: false, endedNormally: false, consistent: true, reached: 'out_of_memory' })
    expect(phase2c25d2dPrimaryOutcome('timeout', 'timeout')).toEqual({ leftOom: true, endedNormally: false, consistent: true, reached: 'timeout' })
    expect(phase2c25d2dPrimaryOutcome('first_candidate', 'first_candidate')).toEqual({ leftOom: true, endedNormally: true, consistent: true, reached: 'first_candidate' })
    expect(phase2c25d2dPrimaryOutcome('first_candidate', 'timeout')).toEqual({ leftOom: true, endedNormally: false, consistent: false, reached: 'modes_differ' })
  })
})

describe('post-hoc analysis', () => {
  const before = parsePhase2C25D2DD2ABefore(d2aResult, items)
  const memory = { heapUsed: 1, heapTotal: 2, rss: 3, external: 0, arrayBuffers: 0 }
  /** A raw mode reproducing a D2-a after view that ended normally. */
  const completedMode = (after: Phase2C25D2AAfter, change: Partial<Phase2C25D2AAfter['view']> = {}): Phase2C25D2ARawMode => {
    const view = { ...after.view, ...change }
    return {
      status: view.status, childOutcome: 'completed', ready: { preSearchMemory: memory, heapSizeLimitBytes: 1, preparationMs: 1 },
      final: { record: { elapsedMs: 1, timeToFirstMs: view.timeToFirstMs, searchSummary: view.searchSummary!, firstCandidateKeySha256: view.firstCandidateKeySha256,
        firstCandidateSummary: null, predictionCounts: view.predictionCounts, predictionCountsAtFirstCandidate: view.predictionCountsAtFirstCandidate },
      postSearchMemory: memory, maxRssKiB: 1 },
      memorySamples: [{ elapsedMs: 1, memory }], lastSnapshot: null, snapshots: 0, v8FatalGc: null,
      process: { wallMs: 1, exitCode: 0, signal: null, timedOut: false },
    }
  }
  const timeoutMode: Phase2C25D2ARawMode = {
    status: 'timeout', childOutcome: 'timeout', ready: { preSearchMemory: memory, heapSizeLimitBytes: 1, preparationMs: 1 }, final: null,
    memorySamples: [{ elapsedMs: 5, memory }], lastSnapshot: null, snapshots: 0, v8FatalGc: null,
    process: { wallMs: 1_200_000, exitCode: null, signal: 'SIGKILL', timedOut: true },
  }

  const raw = (primary: Phase2C25D2ARawMode, change: Partial<Phase2C25D2AAfter['view']> = {}) => ({ runs: items.map(item => {
    const prior = before.get(phase2c25d2dItemKey(item))!
    return item.role === 'primary_oom'
      ? { item, modes: { minimal: primary, instrumented: primary } }
      : { item, modes: { minimal: completedMode(prior.minimal, change), instrumented: completedMode(prior.instrumented, change) } }
  }) })

  it('reports the semantic parity of the cleared reference and the controls, and the primary outcomes as new observations', () => {
    const result = analyzePhase2C25D2DRun(raw(timeoutMode), d2aResult, d2cResult)
    expect(result.totals).toMatchObject({ contexts: 5, primary: 2, primaryLeftOom: 2, primaryEndedNormally: 0, primaryOutcomes: { timeout: 2 },
      semanticParityContexts: 3, semanticParityWithD2A: true, modeSemanticParityFailures: 0 })
    const c12 = result.contexts[0]
    expect(c12.semanticParityWithD2A).toBeNull()
    expect(c12.newObservation?.minimal).toMatchObject({ status: 'timeout', searchSummary: null, firstCandidateKeySha256: null })
    expect(c12.rows[1].status).toEqual({ d2a: 'out_of_memory', d2c: 'out_of_memory', d2d: 'timeout' })
    expect(c12.rows[1].gogmaMaxDepth).toEqual({ d2a: 12, d2c: 12, d2d: null })
    // The D2-c profiled reference fills the instrumented row only.
    expect(c12.rows[0].status.d2c).toBeNull()
    expect(result.contexts[2].role).toBe('cleared_reference')
    expect(result.contexts[2].semanticParityWithD2A?.every(row => row.matches)).toBe(true)
  })

  it('fails the parity on any semantic difference of a context that ended normally in D2-a', () => {
    const result = analyzePhase2C25D2DRun(raw(timeoutMode, { firstCandidateKeySha256: 'another' }), d2aResult, d2cResult)
    expect(result.totals.semanticParityWithD2A).toBe(false)
  })
})

describe('H1 structural audit', () => {
  it('finds no past-depth raw solution retention in the current held-aware stream', () => {
    expect(auditPhase2C25D2DBonusStreamSource(bonusStreamSource)).toEqual({
      reservedSetHoldsRawSolutions: false, readReservedDepthReadsDepths: false, singlePassCursor: true,
      ordinaryDepthCacheKept: true, stepsStillBuiltPerRawSolution: true,
    })
  })

  it('recognises the pre-D2-d shape', () => {
    const pre = [
      '  interface ReservedSet {', '    index: number', '    depths: ReservedBonusStreamSolution[][]', '  }',
      '    readReservedDepth: async (base, depth) => {', '      const set = await ensureReserved(base, depth)', '      const solutions = set.depths[depth - 1] ?? []', '    },',
      '        solutions: cached.depths[depth - 1] ?? [],', '        steps: reservedBonusSteps(state.results),',
    ].join('\n')
    expect(auditPhase2C25D2DBonusStreamSource(pre)).toEqual({
      reservedSetHoldsRawSolutions: true, readReservedDepthReadsDepths: true, singlePassCursor: false,
      ordinaryDepthCacheKept: true, stepsStillBuiltPerRawSolution: true,
    })
  })
})

describe('isolation', () => {
  it('reads no file, fixes no ID and is never imported by Production', () => {
    expect(d2dSource).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
    expect(d2dSource).not.toMatch(/c12-p0|c2-p1|c0-p0|c8-p1|c13-p4|fnv1a32:[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C25D2D/.test(source)).map(([path]) => path)).toEqual([])
  })
})

describe('formal run completeness (post-hoc validator)', () => {
  /** A complete synthetic series over the derived workload: every context once, both modes, 1 contexts + N Search children. */
  const complete = () => ({
    status: 'completed',
    environment: { modes: ['minimal', 'instrumented'], smoke: null, uncommittedBenchmarkCode: false },
    runs: items.map(item => ({ item: structuredClone(item), modes: { minimal: { status: 'first_candidate' }, instrumented: { status: 'first_candidate' } } })),
    processes: [{ role: 'contexts' }, ...items.flatMap(() => [{ role: 'search' }, { role: 'search' }])],
  })
  const validate = (raw: unknown) => validatePhase2C25D2DFormalRun(items, raw)

  it('A. accepts the complete 5 context x 2 mode series, with every count derived from the workload', () => {
    const result = validate(complete())
    expect(result).toMatchObject({
      valid: true, failures: [], expectedContexts: items.length, actualContexts: items.length,
      expectedSearchRuns: items.length * PHASE2C25D2D_MODES.length, actualSearchRuns: items.length * PHASE2C25D2D_MODES.length,
      missingContexts: [], duplicateContexts: [], unexpectedContexts: [], itemMismatches: [], missingModes: [], unexpectedModes: [],
      environmentModeMismatch: false, smokeIsNull: true, uncommittedBenchmarkCode: false, processCountMismatch: false,
    })
    expect(result.expectedContexts).toBe(5)
    expect(result.expectedSearchRuns).toBe(10)
  })

  it('B. rejects a missing context', () => {
    const raw = complete()
    raw.runs.splice(2, 1)
    const result = validate(raw)
    expect(result.valid).toBe(false)
    expect(result.missingContexts).toEqual([phase2c25d2dItemKey(items[2])])
    expect(result.actualSearchRuns).toBe(8)
  })

  it('C. rejects a duplicate context, even an identical record', () => {
    const raw = complete()
    raw.runs.push(structuredClone(raw.runs[0]))
    const result = validate(raw)
    expect(result.valid).toBe(false)
    expect(result.duplicateContexts).toEqual([phase2c25d2dItemKey(items[0])])
  })

  it('D / E. rejects a record missing its minimal or its instrumented mode', () => {
    for (const mode of ['minimal', 'instrumented'] as const) {
      const raw = complete()
      delete (raw.runs[1].modes as Partial<Record<string, unknown>>)[mode]
      const result = validate(raw)
      expect(result.valid).toBe(false)
      expect(result.missingModes).toEqual([{ context: phase2c25d2dItemKey(items[1]), mode }])
      expect(result.actualSearchRuns).toBe(9)
    }
  })

  it('F. rejects a foreign context', () => {
    const raw = complete()
    raw.runs.push({ ...structuredClone(raw.runs[0]), item: { ...structuredClone(items[0]), orientationId: 'foreign-orientation', workIndex: 7 } })
    const result = validate(raw)
    expect(result.valid).toBe(false)
    expect(result.unexpectedContexts).toEqual(['foreign-orientation#7'])
  })

  it('G. rejects an item whose target, role or context digest differs from the workload', () => {
    for (const [field, value] of [['targetWeaponId', 'another-target'], ['role', 'control_first_candidate'], ['contextDigest', 'fnv1a32:ffffffff']] as const) {
      const raw = complete()
      raw.runs[0].item = { ...raw.runs[0].item, [field]: value }
      const result = validate(raw)
      expect(result.valid).toBe(false)
      expect(result.itemMismatches).toEqual([{ context: phase2c25d2dItemKey(items[0]), field, expected: items[0][field], actual: value }])
    }
  })

  it('H / I. rejects environment.modes that is not exactly the two D2-d modes', () => {
    for (const modes of [['minimal'], ['instrumented'], ['minimal', 'instrumented', 'other'], ['minimal', 'minimal']]) {
      const raw = complete()
      raw.environment.modes = modes
      const result = validate(raw)
      expect(result.valid).toBe(false)
      expect(result.environmentModeMismatch).toBe(true)
    }
    const reordered = complete()
    reordered.environment.modes = ['instrumented', 'minimal']
    expect(validate(reordered).valid).toBe(true)
  })

  it('rejects an unknown mode property in a record', () => {
    const raw = complete()
    ;(raw.runs[3].modes as Record<string, unknown>).other = { status: 'first_candidate' }
    const result = validate(raw)
    expect(result.valid).toBe(false)
    expect(result.unexpectedModes).toEqual([{ context: phase2c25d2dItemKey(items[3]), mode: 'other' }])
  })

  it('J. rejects a smoke run, uncommitted benchmark code and a status other than completed', () => {
    const smoke = complete()
    ;(smoke.environment as Record<string, unknown>).smoke = { only: null, modes: ['minimal'], runBudgetMs: 240000 }
    expect(validate(smoke)).toMatchObject({ valid: false, smokeIsNull: false })
    const uncommitted = complete()
    uncommitted.environment.uncommittedBenchmarkCode = true
    expect(validate(uncommitted)).toMatchObject({ valid: false, uncommittedBenchmarkCode: true })
    const parity = complete()
    parity.status = 'parity_failed_no_search_run'
    expect(validate(parity)).toMatchObject({ valid: false, rawStatus: 'parity_failed_no_search_run' })
  })

  it('checks the child process counts as an auxiliary condition', () => {
    const raw = complete()
    raw.processes.pop()
    expect(validate(raw)).toMatchObject({ valid: false, processCountMismatch: true, processCounts: { contexts: 1, search: 9, other: 0 } })
  })

  it('stays post-hoc: no runner imports it, the analyzer runs it before the analysis and writes nothing when it fails', () => {
    expect(runnerSource).not.toMatch(/FormalValidation/)
    expect(d2dSource).not.toMatch(/FormalValidation/)
    expect(formalValidationSource).not.toMatch(/node:fs|readFile|c12-p0|c2-p1|c0-p0|c8-p1|c13-p4/)
    const validation = analyzerSource.indexOf('validatePhase2C25D2DFormalRun(')
    const incomplete = analyzerSource.indexOf('Formal D2-d run is incomplete')
    const analysis = analyzerSource.indexOf('analyzePhase2C25D2DRun(')
    const writing = analyzerSource.indexOf('await writeFile(outputPath')
    expect(validation).toBeGreaterThan(0)
    expect(validation).toBeLessThan(incomplete)
    expect(incomplete).toBeLessThan(analysis)
    expect(analysis).toBeLessThan(writing)
    expect(analyzerSource).toMatch(/'src\/benchmarks\/plannerGlobalPhase2C25D2DFormalValidation\.ts'/)
  })
})
