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
    expect(result.verdicts).toEqual({ mechanics: 'passed', perBoundsSet: {}, allCriteriaPerBoundsSet: {} })
    expect(result.commonGate).toBeNull()
    expect(result.binding).toMatchObject({ bound: 10, missingSlots: [], unplanned: [] })
    expect((result.mechanics as { slotId: string; met: boolean }[]).every(check => check.met)).toBe(true)
    expect((result.semanticGroups as { groupId: string; status: string; nodeReference: string }[]).map(group => [group.groupId, group.status, group.nodeReference]))
      .toEqual([['mech.sanity-3.open', 'identical', 'match'], ['mech.sanity-3.wide', 'identical', 'match']])
    expect((result.cancelTrials as { slotId: string; status: string; rerunCompleted: boolean; rerunIdenticalToGroup: boolean }[]).map(trial => [trial.slotId, trial.status, trial.rerunCompleted, trial.rerunIdenticalToGroup]))
      .toEqual([['mech.cancel.input-check', 'cancel_passed', true, true], ['mech.cancel.reach-table', 'cancel_passed', true, true]])
    expect(bloPublicResultIssues(derived.result, value)).toEqual([])
    expect(bloPublicResultIssues({ ...derived.result, verdicts: { mechanics: 'failed', perBoundsSet: {}, allCriteriaPerBoundsSet: {} } }, value)).toEqual(['The public RESULT is not the one the sources derive.'])
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
    expect(missing.result.verdicts).toEqual({ mechanics: 'failed', perBoundsSet: {}, allCriteriaPerBoundsSet: {} })
    expect((missing.result.binding as { missingSlots: string[] }).missingSlots).toEqual(['mech.bound'])
    const extra = { ...records[0]!, recordId: 'extra', slot: { ...records[0]!.slot, slotId: 'manual.1', planned: false } }
    const withExtra = deriveBloPublicResult(await sources({ browserRaw: await rawFiles([...records, extra]) }))
    if (!withExtra.ok) throw new Error(withExtra.issues.join(' / '))
    expect(withExtra.result.verdicts).toEqual({ mechanics: 'passed', perBoundsSet: {}, allCriteriaPerBoundsSet: {} })
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

describe('Build List optimization measurement analysis: the measurement plan (Issue #260 PR-5A / PR-5B)', async () => {
  // The variants are built from the committed plan whatever its status (proposed in PR-5A, registered in PR-5B), never committed.
  const committed = planOf(measurementPlanText)
  const proposed = structuredClone(committed)
  proposed.status = 'proposed'
  proposed.criteria.status = 'proposed'
  proposed.approval = { state: 'owner_approval_pending', approvedBy: null, approvedOn: null, note: 'test variant' }
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

  interface DriverOptions {
    mode?: 'headed' | 'headless'
    /** Edits the driver's slot entries (index-aligned with the records). */
    slots?: (slots: BloDriverRecord['slots']) => void
    pageRestarts?: BloDriverRecord['pageRestarts']
  }

  function driverOf(planFile: BloSourceFile, records: readonly BloRunRecord[], options: DriverOptions = {}): BloDriverRecord {
    const mode = options.mode ?? 'headed'
    const slots: BloDriverRecord['slots'] = records.map((record, index) => {
      const start = Date.parse(record.startedAt)
      return {
        slotId: record.slot.slotId, sessionId: record.slot.purpose === 'memory' ? 's2-isolated' : 's1-non_isolated', pageIndex: record.slot.purpose === 'memory' ? 2 : 1,
        startedAt: record.startedAt, endedAt: record.endedAt, outcome: 'record_saved', rawFile: `${String(index + 1).padStart(2, '0')}-${record.slot.slotId}.json`, note: null,
        cpuLoadPercentBefore: 5, external: null,
        cdpWorkerHeap: {
          intervalMs: 500, errors: 0,
          samples: record.slot.purpose === 'memory' ? [{ atEpochMs: start + 2000, target: 'worker-1', usedSize: 400_000_000, totalSize: 450_000_000 }, { atEpochMs: start + 9000, target: 'worker-1', usedSize: 430_000_000, totalSize: 470_000_000 }] : [],
          workerTargets: [{ target: 'worker-1', attachedAtEpochMs: start + 950, detachedAtEpochMs: record.timeline.cancelRequestedAtMs === null ? start + 21300 : start + record.timeline.cancelRequestedAtMs + 20 }],
        },
        osRendererMemory: record.slot.purpose === 'memory' ? { intervalMs: 1000, samples: [{ atEpochMs: start + 3000, privateBytes: 1_200_000_000, workingSetBytes: 1_300_000_000, processCount: 2 }] } : null,
      }
    })
    options.slots?.(slots)
    return {
      kind: 'build-list-optimization-browser-driver-record', revision: 2, measurementHead: TEST_MEASUREMENT_HEAD, plan: { path: 'docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md', sha256: planFile.sha256 },
      driverSha256: 'e'.repeat(64), launcher: { browser: 'chrome', version: 'Chrome/154.0', headless: mode === 'headless', mode, planBrowserMode: 'headed', flags: [] }, slotDeadlineMs: 1_800_000,
      machine: { cpuModel: 'test', logicalCpuCount: 16, totalMemoryBytes: 1, os: 'test' },
      sessions: [
        { sessionId: 's1-non_isolated', origin: 'non_isolated', storageBefore: null, storageAfter: null, pageLost: false, pagesOpened: 1, pageOpenFailures: [] },
        { sessionId: 's2-isolated', origin: 'isolated', storageBefore: null, storageAfter: null, pageLost: false, pagesOpened: 1, pageOpenFailures: [] },
      ],
      slots,
      pageRestarts: options.pageRestarts ?? [],
    }
  }

  /** The Node reference of each bounds set carries the set's fingerprint (`shaOf`); `nodeEdit` changes or drops references. */
  type NodeEdit = (records: BloNodeReferenceRecord[]) => BloNodeReferenceRecord[]

  async function sourcesOf(plan: BloMeasurementPlan, records: BloRunRecord[], driver: DriverOptions | null = {}, nodeEdit: NodeEdit = value => value): Promise<BloAnalysisSources> {
    const planFile = await source(`${TEST_MEASUREMENT_HEAD}:docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md`, documentWith(measurementPlanText, plan))
    const nodes = await nodeFiles(nodeEdit(await Promise.all(plan.nodeReference!.runs.map(run => nodeReference(plan, planFile, run.inputId, run.boundsId, { sha256: shaOf(run.boundsId), components: {} })))))
    return {
      measurementHead: TEST_MEASUREMENT_HEAD, plan: planFile, browserRaw: await rawFiles(records),
      driver: driver === null ? null : await source('driver.json', JSON.stringify(driverOf(planFile, records, driver))), nodeReferences: nodes,
    }
  }

  async function analyze(plan: BloMeasurementPlan, records: BloRunRecord[], driver: DriverOptions | null = {}, nodeEdit?: NodeEdit) {
    const value = await sourcesOf(plan, records, driver, nodeEdit)
    const derived = deriveBloPublicResult(value)
    if (!derived.ok) throw new Error(derived.issues.join(' / '))
    return { result: derived.result as Record<string, never>, sources: value }
  }

  const perSetOf = (result: Record<string, never>) => (result.verdicts as { perBoundsSet: Record<string, Record<string, string>> }).perBoundsSet
  const unplannedOf = (result: Record<string, never>) => (result.binding as { unplanned: { slotId: string; reason: string }[] }).unplanned

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
    // The common cancel gate is observed but not judged either.
    expect(result.commonGate).toMatchObject({ verdict: 'not_yet_registered', evidenceBoundsSets: ['w0-research'], appliesToBoundsSets: ['w0-research', 'w0-candidates-3', 'w-half', 'w-wide'] })
    expect(new Set((result.commonGate as { results: { status: string }[] }).results.map(entry => entry.status))).toEqual(new Set(['not_yet_registered']))
    expect(result.verdicts).toMatchObject({ allCriteriaPerBoundsSet: { 'w0-research': 'not_yet_registered', 'w0-candidates-3': 'not_yet_registered', 'w-half': 'not_yet_registered', 'w-wide': 'not_yet_registered' } })
    expect(bloPublicResultIssues(result, sources)).toEqual([])
  })

  const gateOf = (result: Record<string, never>) => result.commonGate as { verdict: string; evidenceBoundsSets: string[]; appliesToBoundsSets: string[]; results: { criterionId: string; status: string; evidenceBoundsId: string; application: string; observed: unknown }[] }
  const allCriteriaOf = (result: Record<string, never>) => (result.verdicts as { allCriteriaPerBoundsSet: Record<string, string> }).allCriteriaPerBoundsSet
  const cancelLifecycleOf = (result: Record<string, never>) => Object.fromEntries(Object.entries(perSetOf(result)).map(([boundsId, verdicts]) => [boundsId, verdicts.cancelLifecycle]))
  const everySet = (verdict: string) => ({ 'w0-research': verdict, 'w0-candidates-3': verdict, 'w-half': verdict, 'w-wide': verdict })
  const COMMON_GATE_IDS = ['cancel.trial-passed', 'cancel.settle', 'cancel.worker-gone', 'cancel.no-result', 'cancel.rerun', 'cancel.rerun-identical']

  it('applies the passed cancel trials of the baseline to every bounds set as one common gate (PR-5B)', async () => {
    const { result, sources } = await analyze(registered, recordsOf(registered))
    const gate = gateOf(result)
    expect(gate).toMatchObject({ verdict: 'passed', evidenceBoundsSets: ['w0-research'], appliesToBoundsSets: ['w0-research', 'w0-candidates-3', 'w-half', 'w-wide'] })
    expect(gate.results.map(entry => [entry.criterionId, entry.status])).toEqual(COMMON_GATE_IDS.map(id => [id, 'passed']))
    // Each comparison set is judged on the baseline's cancel evidence (no cancel run of its own) next to its own storage counts.
    for (const set of result.criteria as { boundsId: string; results: { criterionId: string; application: string; evidenceBoundsId: string; status: string }[] }[]) {
      const cancel = set.results.filter(entry => entry.criterionId.startsWith('cancel.'))
      expect(cancel.map(entry => [entry.criterionId, entry.application, entry.evidenceBoundsId, entry.status]), set.boundsId).toEqual(COMMON_GATE_IDS.map(id => [id, 'common_gate', 'w0-research', 'passed']))
      expect(set.results.find(entry => entry.criterionId === 'lifecycle.storage-counts'), set.boundsId).toMatchObject({ application: 'per_bounds_set', evidenceBoundsId: set.boundsId, status: 'passed' })
    }
    expect(cancelLifecycleOf(result)).toEqual(everySet('passed'))
    expect(allCriteriaOf(result)).toEqual(everySet('passed'))
    const trials = result.cancelTrials as { rerunCompleted: boolean | null; rerunIdenticalToNodeReference: boolean | null }[]
    expect(trials.every(trial => trial.rerunCompleted === true && trial.rerunIdenticalToNodeReference === true)).toBe(true)
    expect(bloPublicResultIssues(result, sources)).toEqual([])
  })

  it('leaves no bounds set adoptable when the common cancel trials failed (PR-5B)', async () => {
    // A cancel trial whose run still completed and adopted its result after the cancel request.
    const adopted = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.cancel.assignment'
      ? { ...fabricatedRecord(bloSlotSpecOfPlan(registered, 'pc.cancel.assignment'), { recordId: record.recordId, sequence: record.sequence, startedAt: record.startedAt, input: record.input }),
          timeline: { ...fabricatedRecord(bloSlotSpecOfPlan(registered, 'pc.cancel.assignment')).timeline, cancelRequestedAtMs: 20500 } } : record)))
    expect(gateOf(adopted.result).verdict).toBe('failed')
    expect(gateOf(adopted.result).results.filter(entry => entry.status === 'failed').map(entry => entry.criterionId)).toEqual(['cancel.trial-passed', 'cancel.no-result'])
    expect(cancelLifecycleOf(adopted.result)).toEqual(everySet('failed'))
    expect(allCriteriaOf(adopted.result)).toEqual(everySet('failed'))
    // A cancel trial that ended with a Worker failure instead of the cancel: failed, never merely unmeasured.
    const errored = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.cancel.reach-table'
      ? { ...record, outcome: { status: 'failed', failure: { kind: 'worker_error' }, cancelReason: null, lastStage: 'reach_table' } } as BloRunRecord : record)))
    expect(gateOf(errored.result).results.find(entry => entry.criterionId === 'cancel.trial-passed')).toMatchObject({ status: 'failed' })
    expect(cancelLifecycleOf(errored.result)).toEqual(everySet('failed'))
    // A slow cancel settle fails the gate for every set (the comparison sets have no cancel runs to pass on their own).
    const slow = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.cancel.input-check' ? { ...record, timeline: { ...record.timeline, outcomeAtMs: 5300 } } : record)))
    expect(gateOf(slow.result).results.find(entry => entry.criterionId === 'cancel.settle')).toMatchObject({ status: 'failed' })
    expect(allCriteriaOf(slow.result)).toEqual(everySet('failed'))
  })

  it('never passes a bounds set whose common cancel evidence is missing or was not exercised (PR-5B)', async () => {
    // Every cancel trial missing: the gate is not comparable, and no set passes on its storage counts alone.
    const missing = await analyze(registered, recordsOf(registered).filter(record => record.slot.purpose !== 'cancel'))
    expect(gateOf(missing.result).verdict).toBe('not_comparable')
    expect(cancelLifecycleOf(missing.result)).toEqual(everySet('not_comparable'))
    expect(allCriteriaOf(missing.result)).toEqual(everySet('not_comparable'))
    for (const set of ['w0-candidates-3', 'w-half', 'w-wide']) expect(perSetOf(missing.result)[set]).toMatchObject({ semantic: 'passed', computation: 'passed', performance: 'passed', memory: 'passed' })
    // One trial missing is enough.
    const oneMissing = await analyze(registered, recordsOf(registered).filter(record => record.slot.slotId !== 'pc.cancel.plan-verification'))
    expect(cancelLifecycleOf(oneMissing.result)).toEqual(everySet('not_comparable'))
    // A trial whose cancel never ran (the calculation finished before the trigger): cancel_not_exercised, never a pass.
    const notExercised = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.cancel.plan-verification'
      ? { ...fabricatedRecord(bloSlotSpecOfPlan(registered, 'pc.cancel.plan-verification'), { recordId: record.recordId, sequence: record.sequence, startedAt: record.startedAt, input: record.input }),
          result: { ...fabricatedRecord(bloSlotSpecOfPlan(registered, 'pc.timing.1')).result!, semantic: { sha256: shaOf('w0-research'), components: {} } } } : record)))
    expect((notExercised.result.cancelTrials as { slotId: string; status: string }[]).find(trial => trial.slotId === 'pc.cancel.plan-verification')!.status).toBe('cancel_not_exercised')
    expect(gateOf(notExercised.result).results.find(entry => entry.criterionId === 'cancel.trial-passed')).toMatchObject({ status: 'unmeasured' })
    expect(gateOf(notExercised.result).verdict).toBe('not_comparable')
    expect(allCriteriaOf(notExercised.result)).toEqual(everySet('not_comparable'))
    // The re-run after the cancels without its Node reference: its semantics are unmeasured, never identical.
    const noNode = await analyze(registered, recordsOf(registered), {}, records => records.filter(record => record.boundsId !== 'w0-research'))
    expect(gateOf(noNode.result).results.find(entry => entry.criterionId === 'cancel.rerun-identical')).toMatchObject({ status: 'unmeasured' })
    expect(cancelLifecycleOf(noNode.result)).toEqual(everySet('not_comparable'))
  })

  it('never overlooks a failed re-run or a re-run whose semantics differ (PR-5B)', async () => {
    // The re-run after the cancels failed: it did not complete, and its semantics are not identical.
    const failed = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.rerun.2'
      ? { ...record, outcome: { status: 'failed', failure: { kind: 'worker_error' }, cancelReason: null, lastStage: 'route_generation' }, result: null } as BloRunRecord : record)))
    expect(gateOf(failed.result).results.filter(entry => entry.status === 'failed').map(entry => entry.criterionId)).toEqual(['cancel.rerun', 'cancel.rerun-identical'])
    expect(cancelLifecycleOf(failed.result)).toEqual(everySet('failed'))
    expect(allCriteriaOf(failed.result)).toEqual(everySet('failed'))
    // The re-run completed with an integrity issue: not a completed re-run.
    const broken = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.rerun.2' ? { ...record, integrityIssues: ['A completed run without a received blo_result.'] } : record)))
    expect(gateOf(broken.result).results.find(entry => entry.criterionId === 'cancel.rerun')).toMatchObject({ status: 'failed' })
    // The re-run completed with other semantics than the Node reference: the gate fails for every set (and the baseline's semantics).
    const differs = await analyze(registered, recordsOf(registered, record => (record.slot.slotId === 'pc.rerun.2' && record.result !== null
      ? { ...record, result: { ...record.result, semantic: { sha256: 'f'.repeat(64), components: {} } } } : record)))
    expect(gateOf(differs.result).results.filter(entry => entry.status === 'failed').map(entry => entry.criterionId)).toEqual(['cancel.rerun-identical'])
    expect(cancelLifecycleOf(differs.result)).toEqual(everySet('failed'))
    expect(perSetOf(differs.result)['w0-research']!.semantic).toBe('failed')
    expect(perSetOf(differs.result)['w-half']!.semantic).toBe('passed')
    expect(allCriteriaOf(differs.result)).toEqual(everySet('failed'))
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

  it('binds a mode-bound environment only to records made in its Browser mode, as the records and the driver both say', async () => {
    const headlessAgent = TEST_USER_AGENT.replace('Chrome/', 'HeadlessChrome/')
    const headlessRecords = recordsOf(registered, record => ({ ...record, environment: { ...record.environment, userAgent: headlessAgent } }))
    // Headless records from a headless launch can never be accepted as the headed measurement the plan requires.
    const headless = await analyze(registered, headlessRecords, { mode: 'headless' })
    expect(new Set(unplannedOf(headless.result).map(entry => entry.reason))).toEqual(new Set(['browser_mode_mismatch']))
    expect(unplannedOf(headless.result)).toHaveLength(16)
    for (const verdicts of Object.values(perSetOf(headless.result))) expect(Object.values(verdicts)).not.toContain('passed')
    // Records that say headed under a driver that launched headless: still a mismatch.
    const relabelled = await analyze(registered, recordsOf(registered), { mode: 'headless' })
    expect(new Set(unplannedOf(relabelled.result).map(entry => entry.reason))).toEqual(new Set(['browser_mode_mismatch']))
    // Without a driver record the mode cannot be verified: nothing binds.
    const unverified = await analyze(registered, recordsOf(registered), null)
    expect(new Set(unplannedOf(unverified.result).map(entry => entry.reason))).toEqual(new Set(['browser_mode_unverified']))
    expect(perSetOf(unverified.result)['w0-research']!.semantic).not.toBe('passed')
    // A driver record naming no consistent mode is refused as a source.
    const sources = await sourcesOf(registered, recordsOf(registered))
    const broken = JSON.parse(sources.driver!.text) as BloDriverRecord
    const inconsistent = { ...broken, launcher: { ...broken.launcher, headless: true, mode: 'headed' } }
    expect(deriveBloPublicResult({ ...sources, driver: await source('driver.json', JSON.stringify(inconsistent)) })).toEqual({ ok: false, issues: ['driver.json: the driver record names no consistent Browser mode.'] })
    const missing = { ...broken, launcher: { ...broken.launcher, mode: undefined } }
    expect(deriveBloPublicResult({ ...sources, driver: await source('driver.json', JSON.stringify(missing)) })).toMatchObject({ ok: false })
    // The headed records of a headed launch bind, and the RESULT names the modes.
    const headed = await analyze(registered, recordsOf(registered))
    expect(unplannedOf(headed.result)).toEqual([])
    expect(headed.result.browserModes).toEqual([{ environmentId: 'pc-windows-chrome', required: 'headed', driver: 'headed', observed: ['headed'] }, { environmentId: 'android-chrome', required: 'headed', driver: 'headed', observed: [] }])
  })

  it('never accepts a slot the driver did not end with a saved record, or a later slot of a page it did not replace', async () => {
    const records = recordsOf(registered)
    const deadlineAt = records.findIndex(record => record.slot.slotId === 'pc.rerun.1')
    // The deadline slot's page was replaced: only that slot is lost, the later ones ran on page 3.
    const replaced = await analyze(registered, records, {
      slots: slots => {
        slots[deadlineAt] = { ...slots[deadlineAt]!, outcome: 'driver_deadline', rawFile: null, note: 'The run did not settle within 1800000 ms.' }
        for (const slot of slots.slice(deadlineAt + 1)) if (slot.pageIndex === 1) slot.pageIndex = 3
      },
      pageRestarts: [{ sessionId: 's1-non_isolated', afterSlotId: 'pc.rerun.1', reason: 'driver_deadline', closedPageIndex: 1, openedPageIndex: 3 }],
    })
    expect(unplannedOf(replaced.result)).toEqual([expect.objectContaining({ slotId: 'pc.rerun.1', reason: 'driver_outcome_not_saved' })])
    expect((replaced.result.binding as { missingSlots: string[] }).missingSlots).toEqual(['pc.rerun.1'])
    expect(perSetOf(replaced.result)['w0-research']!.semantic).toBe('not_comparable')
    expect((replaced.result.driver as { pageRestarts: unknown[] }).pageRestarts).toHaveLength(1)
    // Not replaced: every later slot of that page is refused as well.
    const kept = await analyze(registered, records, { slots: slots => { slots[deadlineAt] = { ...slots[deadlineAt]!, outcome: 'driver_deadline', rawFile: null } } })
    const reasons = new Map(unplannedOf(kept.result).map(entry => [entry.slotId, entry.reason]))
    expect(reasons.get('pc.rerun.1')).toBe('driver_outcome_not_saved')
    expect(reasons.get('pc.cancel.input-check')).toBe('page_not_replaced')
    expect(reasons.get('pc.bounds.w-wide')).toBe('page_not_replaced')
    expect(reasons.has('pc.memory.w-wide')).toBe(false)
    // A record read from another raw file than the one the driver saved for its slot is refused.
    const swapped = await analyze(registered, records, { slots: slots => { slots[0] = { ...slots[0]!, rawFile: '99-other.json' } } })
    expect(unplannedOf(swapped.result)).toEqual([expect.objectContaining({ slotId: 'pc.pilot.1', reason: 'driver_source_mismatch' })])
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
