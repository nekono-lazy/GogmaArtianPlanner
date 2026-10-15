import { describe, expect, it } from 'vitest'
import mechanicsPlanText from '../../../docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md?raw'
import measurementPlanText from '../../../docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md?raw'
import { runBuildListOptimization } from '../../domain/planner/buildListOptimization'
import { createProductionBuildListOptimizationWorkerDependencies } from '../../workers/buildListOptimization.worker.production'
import { loadMasterData } from '../../domain/master/loadMasterData'
import {
  bloPublicResultIssues,
  bloRunIntervals,
  deriveBloPublicResult,
  type BloAnalysisSources,
  type BloDriverRecord,
  type BloNodeReferenceRecord,
  type BloSourceFile,
} from './buildListOptimizationBenchmarkAnalysis'
import { prepareBloBenchmarkInput } from './buildListOptimizationBenchmarkInput'
import { BLO_PLAN_BEGIN, BLO_PLAN_END, bloSlotSpecOfPlan, extractBloMeasurementPlan, type BloMeasurementPlan } from './buildListOptimizationBenchmarkPlan'
import type { BloRunRecord } from './buildListOptimizationBenchmarkProtocol'
import { createBloBenchmarkRunner } from './buildListOptimizationBenchmarkRunner'
import { bloSemanticFingerprint } from './buildListOptimizationBenchmarkSemantic'
import { bloSyntheticExportText } from './buildListOptimizationBenchmarkSynthetic'
import { createTestRunnerPorts, fabricatedRecord, TEST_MEASUREMENT_HEAD, TEST_USER_AGENT, testInput, testSha256 } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the post-hoc analysis. The mechanics plan is run end to end through the runner (in process) and its public RESULT
 * re-derived; the proposed measurement plan yields observations only (`not_yet_registered`); a registered variant is judged per bounds
 * set; and the analysis refuses records of other code, never counts a missing run as a pass and never publishes an identity.
 */

const master = (() => {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('The Master Data does not load.')
  return loaded.data
})()

function planOf(text: string): BloMeasurementPlan {
  return extractBloMeasurementPlan(text).plan as BloMeasurementPlan
}

/** The plan document with its plan block replaced by `plan` (a variant for a test; never committed). */
function documentWith(text: string, plan: BloMeasurementPlan): string {
  const start = text.indexOf(BLO_PLAN_BEGIN) + BLO_PLAN_BEGIN.length
  return `${text.slice(0, start)}\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n${text.slice(text.indexOf(BLO_PLAN_END))}`
}

async function source(file: string, text: string): Promise<BloSourceFile> {
  return { file, bytes: new TextEncoder().encode(text).length, sha256: await testSha256(text), text }
}

async function rawFiles(records: readonly BloRunRecord[]): Promise<BloSourceFile[]> {
  return Promise.all(records.map((record, index) => source(`${String(index + 1).padStart(2, '0')}-${record.slot.slotId}.json`,
    JSON.stringify({ kind: 'build-list-optimization-browser-records', recordProtocol: 'build-list-optimization-browser-record:1', exportedAt: '2026-10-15T00:00:00.000Z', records: [record] }, null, 2))))
}

async function nodeReference(plan: BloMeasurementPlan, planFile: BloSourceFile, inputId: string, boundsId: string, semantic?: BloNodeReferenceRecord['semantic']): Promise<BloNodeReferenceRecord> {
  const input = plan.inputs.find(entry => entry.inputId === inputId)!
  const bounds = plan.boundsSets.find(entry => entry.boundsId === boundsId)!.bounds
  let value = semantic ?? null
  let identity: BloNodeReferenceRecord['inputIdentity']
  if (input.kind === 'synthetic') {
    const text = bloSyntheticExportText(input.caseId)
    identity = { kind: 'synthetic', fileName: null, caseId: input.caseId, bytes: new TextEncoder().encode(text).length, sha256: await testSha256(text) }
    if (value === null) {
      const prepared = await prepareBloBenchmarkInput(text, master, () => performance.now())
      if (prepared.status !== 'ready') throw new Error('refused')
      const run = await runBuildListOptimization(prepared.plannerInput, createProductionBuildListOptimizationWorkerDependencies(), structuredClone(bounds))
      if (run.kind !== 'result') throw new Error('cancelled')
      value = await bloSemanticFingerprint(run.result, testSha256)
    }
  } else {
    identity = { kind: 'export', fileName: input.fileName, caseId: null, bytes: input.bytes, sha256: input.sha256 }
  }
  return {
    kind: 'build-list-optimization-node-reference', revision: 1, measurementHead: TEST_MEASUREMENT_HEAD, plan: { path: planFile.file.split(':')[1]!, sha256: planFile.sha256 },
    inputId, boundsId, inputIdentity: identity, bounds, node: { version: 'v24', platform: 'test' }, outcome: { status: 'completed', failure: null, refusal: null },
    resultStatus: 'optimized', semantic: value, elapsedMs: 100,
  }
}

async function nodeFiles(records: readonly BloNodeReferenceRecord[]): Promise<BloSourceFile[]> {
  return Promise.all(records.map((record, index) => source(`node-${index + 1}.json`, JSON.stringify(record, null, 2))))
}

/** Runs every slot of the mechanics plan through the runner, in plan order, on one page session. */
async function runMechanics(plan: BloMeasurementPlan): Promise<BloRunRecord[]> {
  let isolated = false
  const ports = createTestRunnerPorts({
    environment: () => ({ userAgent: TEST_USER_AGENT, language: 'ja', hardwareConcurrency: 16, deviceMemory: 8, crossOriginIsolated: isolated, isSecureContext: true, visibilityAtStart: 'visible' }),
    // In process the calculation never yields: the cancel trigger runs at once (see the runner test), and no wait is needed.
    schedule: (callback) => { callback(); return () => undefined },
    sleep: async () => undefined,
  })
  const runner = createBloBenchmarkRunner(ports)
  const records: BloRunRecord[] = []
  for (const slot of [...plan.environments[0]!.slots].sort((left, right) => left.order - right.order)) {
    isolated = slot.origin === 'isolated'
    const input = plan.inputs.find(entry => entry.inputId === slot.inputId)!
    records.push(await runner.run(bloSlotSpecOfPlan(plan, slot.slotId), await testInput(input.kind === 'synthetic' ? input.caseId : '')))
  }
  return records
}

describe('Build List optimization measurement analysis: the mechanics plan end to end (Issue #260 PR-5A)', async () => {
  const plan = planOf(mechanicsPlanText)
  const planFile = await source(`${TEST_MEASUREMENT_HEAD}:docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md`, mechanicsPlanText)
  const records = await runMechanics(plan)
  const nodes = await nodeFiles(await Promise.all(plan.nodeReference!.runs.map(run => nodeReference(plan, planFile, run.inputId, run.boundsId))))
  const sources = async (overrides: Partial<BloAnalysisSources> = {}): Promise<BloAnalysisSources> => ({
    measurementHead: TEST_MEASUREMENT_HEAD, plan: planFile, browserRaw: await rawFiles(records), driver: null, nodeReferences: nodes, ...overrides,
  })

  it('derives a passing mechanics RESULT and re-derives it from the same sources', async () => {
    const value = await sources()
    const derived = deriveBloPublicResult(value)
    if (!derived.ok) throw new Error(derived.issues.join(' / '))
    const result = derived.result as Record<string, never>
    expect(result.verdicts).toEqual({ mechanics: 'passed', perBoundsSet: {} })
    expect(result.binding).toMatchObject({ bound: 10, missingSlots: [], unplanned: [] })
    expect((result.mechanics as { slotId: string; met: boolean }[]).every(check => check.met)).toBe(true)
    expect((result.semanticGroups as { groupId: string; status: string; nodeReference: string }[]).map(group => [group.groupId, group.status, group.nodeReference]))
      .toEqual([['mech.sanity-3.open', 'identical', 'match'], ['mech.sanity-3.wide', 'identical', 'match']])
    expect((result.cancelTrials as { slotId: string; status: string; rerunCompleted: boolean; rerunIdenticalToGroup: boolean }[]).map(trial => [trial.slotId, trial.status, trial.rerunCompleted, trial.rerunIdenticalToGroup]))
      .toEqual([['mech.cancel.input-check', 'cancel_passed', true, true], ['mech.cancel.reach-table', 'cancel_passed', true, true]])
    expect(bloPublicResultIssues(derived.result, value)).toEqual([])
    expect(bloPublicResultIssues({ ...derived.result, verdicts: { mechanics: 'failed', perBoundsSet: {} } }, value)).toEqual(['The public RESULT is not the one the sources derive.'])
    // No identity, Seed / Counter value or path of the measured data reaches the RESULT.
    const text = JSON.stringify(derived.result)
    expect(text).not.toMatch(/target\.issue103|build-list\.fnv1a32|owned\.issue103|51231782|"baseSeed"|"targetWeaponId"/)
  }, 120_000)

  it('refuses records of other code, and never counts a missing or unplanned run', async () => {
    const other = records.map((record, index) => (index === 0 ? { ...record, build: { commit: 'f'.repeat(40), uncommittedBenchmarkCode: false } } : record))
    expect(deriveBloPublicResult(await sources({ browserRaw: await rawFiles(other) }))).toEqual({ ok: false, issues: [expect.stringMatching(/not the measurement HEAD/)] })
    const dirty = records.map((record, index) => (index === 0 ? { ...record, build: { commit: TEST_MEASUREMENT_HEAD, uncommittedBenchmarkCode: true } } : record))
    expect(deriveBloPublicResult(await sources({ browserRaw: await rawFiles(dirty) }))).toMatchObject({ ok: false })
    const missing = deriveBloPublicResult(await sources({ browserRaw: await rawFiles(records.filter(record => record.slot.slotId !== 'mech.bound')) }))
    if (!missing.ok) throw new Error(missing.issues.join(' / '))
    expect(missing.result.verdicts).toEqual({ mechanics: 'failed', perBoundsSet: {} })
    expect((missing.result.binding as { missingSlots: string[] }).missingSlots).toEqual(['mech.bound'])
    const extra = { ...records[0]!, recordId: 'extra', slot: { ...records[0]!.slot, slotId: 'manual.1', planned: false } }
    const withExtra = deriveBloPublicResult(await sources({ browserRaw: await rawFiles([...records, extra]) }))
    if (!withExtra.ok) throw new Error(withExtra.issues.join(' / '))
    expect(withExtra.result.verdicts).toEqual({ mechanics: 'passed', perBoundsSet: {} })
    expect((withExtra.result.binding as { unplanned: unknown[] }).unplanned).toEqual([{ slotId: 'manual.1', purpose: 'mechanics', reason: 'not_planned' }])
    // A Node reference that disagrees is a mismatch, never a pass.
    const wrongNode = await nodeFiles([await nodeReference(plan, planFile, 'sanity-3', 'synthetic.open', { sha256: '0'.repeat(64), components: {} })])
    const mismatch = deriveBloPublicResult(await sources({ nodeReferences: wrongNode }))
    if (!mismatch.ok) throw new Error(mismatch.issues.join(' / '))
    expect((mismatch.result.semanticGroups as { status: string; nodeReference: string }[]).map(group => [group.status, group.nodeReference])).toEqual([['mismatch', 'mismatch'], ['incomplete', 'missing']])
    // A source of another plan or HEAD is refused.
    expect(deriveBloPublicResult(await sources({ nodeReferences: await nodeFiles([{ ...JSON.parse(nodes[0]!.text), measurementHead: 'f'.repeat(40) }]) }))).toMatchObject({ ok: false })
  }, 120_000)
})

describe('Build List optimization measurement analysis: the measurement plan (Issue #260 PR-5A)', async () => {
  const proposed = planOf(measurementPlanText)
  /** One fingerprint per bounds set (the runs of one set agree; the sets differ). */
  const shaOf = (boundsId: string) => [...boundsId].map(character => character.charCodeAt(0).toString(16)).join('').padEnd(64, '0').slice(0, 64)
  const input = proposed.inputs[0]!
  const identity = input.kind === 'export' ? { kind: 'export' as const, fileName: input.fileName, bytes: input.bytes, sha256: input.sha256 } : null

  function recordsOf(plan: BloMeasurementPlan, edit: (record: BloRunRecord) => BloRunRecord = record => record): BloRunRecord[] {
    return plan.environments[0]!.slots.map((slot, index) => {
      const spec = bloSlotSpecOfPlan(plan, slot.slotId)
      let record = fabricatedRecord(spec, { recordId: `r#${index + 1}`, sequence: index + 1, startedAt: `2026-10-15T01:${String(index).padStart(2, '0')}:00.000Z` })
      record = { ...record, input: { ...record.input, identity }, result: record.result === null ? null : { ...record.result, semantic: { sha256: shaOf(slot.boundsId), components: {} } } }
      if (slot.purpose === 'cancel') {
        record = { ...record, outcome: { status: 'cancelled', failure: null, cancelReason: 'cancelled', lastStage: slot.cancelTrigger!.stage }, result: null,
          timeline: { ...record.timeline, terminalReceivedAtMs: null, terminalType: null, terminalDataReadMs: null, clientHandlingMs: null, cancelRequestedAtMs: 5000, outcomeAtMs: 5001 } }
      }
      if (slot.purpose === 'memory') {
        record = { ...record, memory: [
          { label: 'before_run', atMs: 950, mainHeap: { usedJSHeapSize: 50_000_000, totalJSHeapSize: 80_000_000, jsHeapSizeLimit: 4_000_000_000 }, userAgentSpecific: null, error: null },
          { label: 'after_outcome', atMs: 21300, mainHeap: { usedJSHeapSize: 90_000_000, totalJSHeapSize: 120_000_000, jsHeapSizeLimit: 4_000_000_000 }, userAgentSpecific: { bytes: 600_000_000, workerBytes: 0, windowBytes: 600_000_000, otherBytes: 0 }, error: null },
          { label: 'after_release', atMs: 32000, mainHeap: { usedJSHeapSize: 60_000_000, totalJSHeapSize: 120_000_000, jsHeapSizeLimit: 4_000_000_000 }, userAgentSpecific: { bytes: 70_000_000, workerBytes: 0, windowBytes: 70_000_000, otherBytes: 0 }, error: null },
        ] }
      }
      return edit(record)
    })
  }

  function driverOf(planFile: BloSourceFile, records: readonly BloRunRecord[]): BloDriverRecord {
    return {
      kind: 'build-list-optimization-browser-driver-record', revision: 1, measurementHead: TEST_MEASUREMENT_HEAD, plan: { path: 'docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md', sha256: planFile.sha256 },
      driverSha256: 'e'.repeat(64), launcher: { browser: 'chrome', version: 'Chrome/154.0', headless: false, flags: [] }, machine: { cpuModel: 'test', logicalCpuCount: 16, totalMemoryBytes: 1, os: 'test' },
      sessions: [{ sessionId: 's1-non_isolated', origin: 'non_isolated', storageBefore: null, storageAfter: null, pageLost: false }],
      slots: records.map(record => {
        const start = Date.parse(record.startedAt)
        return {
          slotId: record.slot.slotId, sessionId: 's1', startedAt: record.startedAt, endedAt: record.endedAt, outcome: 'record_saved', rawFile: `${record.slot.slotId}.json`, cpuLoadPercentBefore: 5, external: null,
          cdpWorkerHeap: {
            intervalMs: 500, errors: 0,
            samples: record.slot.purpose === 'memory' ? [{ atEpochMs: start + 2000, target: 'worker-1', usedSize: 400_000_000, totalSize: 450_000_000 }, { atEpochMs: start + 9000, target: 'worker-1', usedSize: 430_000_000, totalSize: 470_000_000 }] : [],
            workerTargets: [{ target: 'worker-1', attachedAtEpochMs: start + 950, detachedAtEpochMs: record.timeline.cancelRequestedAtMs === null ? start + 21300 : start + record.timeline.cancelRequestedAtMs + 20 }],
          },
          osRendererMemory: record.slot.purpose === 'memory' ? { intervalMs: 1000, samples: [{ atEpochMs: start + 3000, privateBytes: 1_200_000_000, workingSetBytes: 1_300_000_000, processCount: 2 }] } : null,
        }
      }),
    }
  }

  async function analyze(plan: BloMeasurementPlan, records: BloRunRecord[]) {
    const planFile = await source(`${TEST_MEASUREMENT_HEAD}:docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md`, documentWith(measurementPlanText, plan))
    const semanticOf = (boundsId: string) => records.find(record => record.slot.boundsId === boundsId && record.result !== null)!.result!.semantic
    const nodes = await nodeFiles(await Promise.all(plan.nodeReference!.runs.map(run => nodeReference(plan, planFile, run.inputId, run.boundsId, semanticOf(run.boundsId)))))
    const driver = driverOf(planFile, records)
    const value: BloAnalysisSources = { measurementHead: TEST_MEASUREMENT_HEAD, plan: planFile, browserRaw: await rawFiles(records), driver: await source('driver.json', JSON.stringify(driver)), nodeReferences: nodes }
    const derived = deriveBloPublicResult(value)
    if (!derived.ok) throw new Error(derived.issues.join(' / '))
    return { result: derived.result as Record<string, never>, sources: value }
  }

  const registered = structuredClone(proposed)
  registered.status = 'registered'
  registered.criteria.status = 'registered'
  registered.approval = { state: 'owner_approved', approvedBy: 'test owner', approvedOn: '2026-10-16', note: 'test variant' }

  it('reports observations only while the plan is a proposal: every judgement is not_yet_registered', async () => {
    const { result, sources } = await analyze(proposed, recordsOf(proposed))
    expect(result.plan).toMatchObject({ status: 'proposed', approval: 'owner_approval_pending', criteriaStatus: 'proposed', judged: false })
    const perSet = (result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet
    expect(Object.keys(perSet)).toEqual(['w0-research', 'w0-candidates-3', 'w-half', 'w-wide'])
    for (const verdicts of Object.values(perSet)) expect(new Set(Object.values(verdicts))).toEqual(new Set(['not_yet_registered']))
    const criteria = result.criteria as { boundsId: string; results: { criterionId: string; status: string; observed: unknown }[] }[]
    expect(criteria.flatMap(set => set.results.map(entry => entry.status))).toEqual(expect.arrayContaining(['not_yet_registered']))
    expect(new Set(criteria.flatMap(set => set.results.map(entry => entry.status)))).toEqual(new Set(['not_yet_registered']))
    expect(criteria.find(set => set.boundsId === 'w0-research')!.results.find(entry => entry.criterionId === 'performance.request-to-result.median')!.observed).toBe(20000)
    expect(bloPublicResultIssues(result, sources)).toEqual([])
  })

  it('judges a registered plan per bounds set, and never counts an unmeasured value as a pass', async () => {
    const passing = await analyze(registered, recordsOf(registered))
    const perSet = (passing.result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet
    expect(perSet['w0-research']).toEqual({ semantic: 'passed', computation: 'passed', performance: 'passed', memory: 'passed', cancelLifecycle: 'passed' })
    expect(perSet['w-wide']).toEqual({ semantic: 'passed', computation: 'passed', performance: 'passed', memory: 'passed', cancelLifecycle: 'passed' })
    const trials = passing.result.cancelTrials as { status: string; workerGoneAfterCancelMs: number | null; cancelSettleMs: number | null }[]
    expect(trials.map(trial => trial.status)).toEqual(['cancel_passed', 'cancel_passed', 'cancel_passed', 'cancel_passed', 'cancel_passed'])
    expect(trials[0]).toMatchObject({ workerGoneAfterCancelMs: 20, cancelSettleMs: 1 })

    // One slow timing run of the baseline: its performance fails, the other sets are untouched.
    const slow = await analyze(registered, recordsOf(registered, record => record.slot.slotId === 'pc.rerun.1'
      ? { ...record, timeline: { ...record.timeline, terminalReceivedAtMs: 90_000, outcomeAtMs: 90_200 } } : record))
    const slowSets = (slow.result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet
    expect(slowSets['w0-research']!.performance).toBe('failed')
    expect(slowSets['w-half']!.performance).toBe('passed')

    // A memory slot without its fixed points: the memory axis cannot be judged (not_comparable), never passed.
    const noMemory = await analyze(registered, recordsOf(registered, record => record.slot.slotId === 'pc.memory.w-half' ? { ...record, memory: [] } : record))
    expect((noMemory.result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet['w-half']!.memory).toBe('not_comparable')

    // A comparison set that is not optimized fails the computation axis of that set only.
    const bound = await analyze(registered, recordsOf(registered, record => record.slot.boundsId === 'w-half' && record.result !== null
      ? { ...record, result: { ...record.result, status: 'search_bound_reached', boundKinds: ['structural_search_node_budget'], completedTargetCount: null, planningTargetCount: null } } : record))
    const boundSets = (bound.result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet
    expect(boundSets['w-half']!.computation).toBe('failed')
    expect(boundSets['w0-research']!.computation).toBe('passed')
  })

  it('names every interval apart and never mixes them into one total', () => {
    const intervals = bloRunIntervals(fabricatedRecord(bloSlotSpecOfPlan(proposed, 'pc.timing.1')))
    expect(intervals).toMatchObject({
      inputPreparationMs: 900, workerCreateToRequestPostedMs: 50, requestPostMs: 38, requestToFirstProgressMs: 100, requestToTerminalMs: 20000,
      terminalDataReadMs: 30, clientHandlingMs: 120, workerStageTotalMs: 19900, workerCreateToOutcomeMs: 20250, endToEndMs: 21200, cancelSettleMs: null,
    })
    expect(intervals.mainObservedStageMs).toEqual({ input_check: 900, reach_table: 9000, assignment_search: 1000, route_generation: 1000, plan_verification: 8000 })
  })
})
