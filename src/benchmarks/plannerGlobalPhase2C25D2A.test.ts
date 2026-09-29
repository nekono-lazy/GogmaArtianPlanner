import { describe, expect, it } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import {
  analyzePhase2C25D2ARun,
  comparePhase2C25D2AControl,
  parsePhase2C25D2ABefore,
  phase2c25d2aItemKey,
  phase2c25d2aOomOutcome,
  phase2c25d2aSampledMemory,
  phase2c25d2aWorkloadItems,
  PHASE2C25D2A_CHILD_HEAP_MB,
  PHASE2C25D2A_CANDIDATE_STOP_BOUND,
  PHASE2C25D2A_WORKLOAD_RULE,
  type Phase2C25D2AModeView,
  type Phase2C25D2ARawMode,
} from './plannerGlobalPhase2C25D2A'
import { parsePhase2C25CEvidence, selectPhase2C25CWorkload } from './plannerGlobalPhase2C25C'

const view = parsePhase2C25CEvidence(c25aEvidence)
const workload = selectPhase2C25CWorkload(view)
const items = phase2c25d2aWorkloadItems(workload)

describe('workload of Phase 2-C2.5-D2-a (derived from the C2.5-A evidence)', () => {
  it('keeps the C2.5-A conditions', () => {
    expect(PHASE2C25D2A_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C25D2A_CANDIDATE_STOP_BOUND).toBe(1)
    expect(PHASE2C25D2A_WORKLOAD_RULE).toBe(workload.rule)
  })

  it('selects every Search-only OOM representative, then the first first_candidate and the first extent-stop control', () => {
    expect(items.map(item => `${phase2c25d2aItemKey(item)}:${item.role}`)).toEqual([
      'c0-p0#0:oom_representative', 'c12-p0#0:oom_representative', 'c2-p1#0:oom_representative',
      'c8-p1#0:control_first_candidate', 'c13-p4#0:control_stopped_by_extent',
    ])
  })
})

describe('the C2.5-A before view', () => {
  const before = parsePhase2C25D2ABefore(c25aEvidence, items)

  it('reads every mode and the last instrumented snapshot of each selected context', () => {
    const c0 = before.get('c0-p0#0')!
    expect(c0.minimal.status).toBe('out_of_memory')
    expect(c0.instrumented.status).toBe('out_of_memory')
    expect(c0.instrumentedMetrics?.gogmaMaxDepth).toBe(134)
    expect(c0.instrumentedLastSnapshot?.sampledMax.heapUsed).toBe(8496179736)
    expect(c0.minimal.v8FatalGc?.lastGc.beforeMb).toBe(8182.4)
    const c8 = before.get('c8-p1#0')!
    expect(c8.minimal.status).toBe('first_candidate')
    expect(c8.instrumented.predictionCounts).toEqual({ predictNormalArtian: 4, predictSkills: 5, resetBonuses: 119, keepBonuses: 6079 })
    expect(before.get('c13-p4#0')!.minimal.status).toBe('stopped_by_extent_before_candidate')
  })

  it('fails closed when the evidence index names another context', () => {
    expect(() => parsePhase2C25D2ABefore(c25aEvidence, [{ ...items[0], evidenceIndex: items[1].evidenceIndex }])).toThrow(/is not c0-p0#0/)
  })
})

describe('sampled memory', () => {
  it('reports sampled maxima and the last sample, never a peak claim', () => {
    const sample = (heapUsed: number, heapTotal: number, rss: number, elapsedMs: number) => ({ elapsedMs, memory: { heapUsed, heapTotal, rss } })
    expect(phase2c25d2aSampledMemory([sample(5, 9, 20, 1), sample(7, 8, 19, 2), sample(6, 10, 18, 3)])).toEqual({
      samples: 3, sampledMax: { heapUsed: 7, heapTotal: 10, rss: 20 }, last: { heapUsed: 6, heapTotal: 10, rss: 18 }, lastAtElapsedMs: 3,
    })
    expect(phase2c25d2aSampledMemory([])).toEqual({ samples: 0, sampledMax: null, last: null, lastAtElapsedMs: null })
  })
})

describe('control semantic parity', () => {
  const base: Phase2C25D2AModeView = {
    status: 'first_candidate', searchElapsedMs: 1, timeToFirstMs: 1,
    searchSummary: { deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: true, skippedExcludedRouteKeys: 0 },
    firstCandidateKeySha256: 'a', firstCandidate: null, predictionCounts: { predictNormalArtian: 1, predictSkills: 2, resetBonuses: 3, keepBonuses: 4 },
    predictionCountsAtFirstCandidate: null, preSearchMemory: null, postSearchMemory: null, maxRssKiB: null, heapSizeLimitBytes: null, v8FatalGc: null,
  }
  const item = { orientationId: 'o', workIndex: 0 }

  it('matches only when status, summary, first key, counts and extent flags are equal', () => {
    expect(comparePhase2C25D2AControl(item, 'instrumented', base, { ...base, searchElapsedMs: 99 }).matches).toBe(true)
    expect(comparePhase2C25D2AControl(item, 'instrumented', base, { ...base, firstCandidateKeySha256: 'b' }).matches).toBe(false)
    expect(comparePhase2C25D2AControl(item, 'instrumented', base, { ...base, predictionCounts: { ...base.predictionCounts!, keepBonuses: 5 } }).matches).toBe(false)
    const extent = comparePhase2C25D2AControl(item, 'instrumented', base, { ...base, searchSummary: { ...base.searchSummary, stoppedByExtent: true } })
    expect(extent.extentAndExhaustionMatch).toBe(false)
    expect(extent.matches).toBe(false)
    // The minimal mode counts nothing, so its counts never decide the parity.
    expect(comparePhase2C25D2AControl(item, 'minimal', { ...base, predictionCounts: null }, { ...base, predictionCounts: null }).predictionCountsMatch).toBeNull()
  })
})

describe('OOM representative outcome', () => {
  it('states what a representative reached, never "solved"', () => {
    expect(phase2c25d2aOomOutcome('out_of_memory', 'out_of_memory')).toEqual({ leftOom: false, consistent: true, reached: 'out_of_memory' })
    expect(phase2c25d2aOomOutcome('stopped_by_extent_before_candidate', 'stopped_by_extent_before_candidate'))
      .toEqual({ leftOom: true, consistent: true, reached: 'stopped_by_extent_before_candidate' })
    expect(phase2c25d2aOomOutcome('first_candidate', 'out_of_memory')).toEqual({ leftOom: false, consistent: false, reached: 'modes_differ' })
  })
})

describe('post-hoc analysis', () => {
  const before = parsePhase2C25D2ABefore(c25aEvidence, items)
  const memory = { heapUsed: 1, heapTotal: 2, rss: 3, external: 0, arrayBuffers: 0 }
  /** A raw mode reproducing the C2.5-A final record of a completed control. */
  const completedMode = (view: Phase2C25D2AModeView): Phase2C25D2ARawMode => ({
    status: view.status, childOutcome: 'completed', ready: { preSearchMemory: memory, heapSizeLimitBytes: 1, preparationMs: 1 },
    final: { record: { elapsedMs: 1, timeToFirstMs: view.timeToFirstMs, searchSummary: view.searchSummary!, firstCandidateKeySha256: view.firstCandidateKeySha256,
      firstCandidateSummary: null, predictionCounts: view.predictionCounts, predictionCountsAtFirstCandidate: view.predictionCountsAtFirstCandidate },
    postSearchMemory: memory, maxRssKiB: 1 },
    memorySamples: [{ elapsedMs: 1, memory }], lastSnapshot: null, snapshots: 0, v8FatalGc: null,
    process: { wallMs: 1, exitCode: 0, signal: null, timedOut: false },
  })
  const oomMode: Phase2C25D2ARawMode = {
    status: 'out_of_memory', childOutcome: 'out_of_memory', ready: null, final: null, memorySamples: [{ elapsedMs: 5, memory }], lastSnapshot: null, snapshots: 0,
    v8FatalGc: { lastGc: { atMs: 1, kind: 'Mark-Compact', beforeMb: 8000, beforeCommittedMb: 8000, afterMb: 8000, afterCommittedMb: 8000 }, fatal: true },
    process: { wallMs: 1, exitCode: 134, signal: null, timedOut: false },
  }

  it('reports control parity, OOM outcomes and before / after rows', () => {
    const raw = { runs: items.map(item => {
      const prior = before.get(phase2c25d2aItemKey(item))!
      return item.role === 'oom_representative'
        ? { item, modes: { minimal: oomMode, instrumented: oomMode } }
        : { item, modes: { minimal: completedMode(prior.minimal), instrumented: completedMode(prior.instrumented) } }
    }) }
    const result = analyzePhase2C25D2ARun(raw, c25aEvidence)
    expect(result.totals).toMatchObject({ contexts: 5, oomRepresentatives: 3, controls: 2, oomRepresentativesLeftOom: 0, controlsSemanticParity: true, modeSemanticParityFailures: 0 })
    const c0 = result.contexts[0]
    expect(c0.rows.map(row => [row.mode, row.status, row.v8FatalGcBeforeMb])).toEqual([
      ['minimal', { before: 'out_of_memory', after: 'out_of_memory' }, { before: 8182.4, after: 8000 }],
      ['instrumented', { before: 'out_of_memory', after: 'out_of_memory' }, { before: 8175.4, after: 8000 }],
    ])
    // The C2.5-A minimal mode sampled no memory; its before value is absent, never zero.
    expect(c0.rows[0].sampledMaxHeapUsed).toEqual({ before: null, after: 1 })
    expect(c0.rows[1].sampledMaxHeapUsed).toEqual({ before: 8496179736, after: 1 })
    expect(c0.rows[1].gogmaMaxDepth).toEqual({ before: 134, after: null })
    // A completed run's sampled series includes its pre-Search and post-Search samples.
    expect(result.contexts[3].after.minimal?.memory.samples).toBe(3)
  })

  it('fails the control parity on any semantic difference', () => {
    const control = items[3]
    const prior = before.get(phase2c25d2aItemKey(control))!
    const changed = completedMode({ ...prior.instrumented, firstCandidateKeySha256: 'another' })
    const result = analyzePhase2C25D2ARun({ runs: [{ item: control, modes: { minimal: completedMode(prior.minimal), instrumented: changed } }] }, c25aEvidence)
    expect(result.totals.controlsSemanticParity).toBe(false)
    expect(result.contexts[0].modeSemanticParity).toBe(false)
  })
})
