import { beforeAll, describe, expect, it } from 'vitest'
import { concludeD1cMeasurement } from '../verificationFormal'
import { deriveD1cPublicResult } from '../verificationFormalResult'
import { d1cFixture } from '../verificationFormalTestFixture'
import {
  analyzeGabMeasurement, deriveGabPublicResult, GabAnalysisSourceError, gabMaterializationViewOfSemantic, gabPublicResultIssues, gabPublicResultMinimizationIssues,
  gabVerificationViewOfSemantic, readGabD1cReference, GAB_DRIVER_RECORD_KIND, type GabAnalysisSources, type GabSourceFile,
} from './globalAssignmentBrowserAnalysis'
import type { GabMeasurementPlan } from './globalAssignmentBrowserMeasurementPlan'
import {
  P2_ENVIRONMENT, P2_HEAD, p2D1cResult, p2DefaultSlots, p2NodeReference, p2Ports, p2RecordRuns, p2SourceFile, p2Sources, p2World, type P2World,
} from './globalAssignmentBrowserP2TestFixture'

/*
 * Issue #154 Production準備 P-2 (design 12 / 16.2): the post-hoc analysis over real logical run records of the synthetic scenario (the
 * runner, harness and controller in this realm), a Node reference written the way the D-1A runner writes it, and a D-1C-shaped
 * reference. It binds the records to the committed plan, judges parity, cancel trials and the tally apart, fails closed on sources it
 * cannot read, and derives a minimized public RESULT that re-derives identically from the same sources.
 */

const d1cResultDocs = import.meta.glob('../../../../docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

let world: P2World
let plan: GabMeasurementPlan
let measured: Awaited<ReturnType<typeof p2RecordRuns>>
let node: Awaited<ReturnType<typeof p2NodeReference>>
let d1c: Awaited<ReturnType<typeof p2D1cResult>>

/** The default measurement: every slot in plan order, the cancel slot's results delayed so that its planned trigger lands first (C2). */
beforeAll(async () => {
  world = await p2World()
  plan = world.plan()
  const slots = p2DefaultSlots()
  measured = await p2RecordRuns(world, slots.map(slot => ({ slot, delayResultMs: slot.purpose === 'cancel' ? 200 : 0 })))
  node = await p2NodeReference(world)
  d1c = await p2D1cResult(world, node)
}, 180_000)

const sourcesWith = (parts: Partial<Parameters<typeof p2Sources>[0]> = {}) => p2Sources({ plan, raw: measured.raw, node, d1c, ...parts })

async function editRaw(index: number, edit: (raw: { records: Record<string, any>[] }) => void): Promise<GabSourceFile[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = measured.raw.map(file => ({ ...file }))
  const value = JSON.parse(raw[index]!.text)
  edit(value)
  raw[index] = await p2SourceFile(raw[index]!.file, JSON.stringify(value, null, 2))
  return raw
}

describe('P-2 analysis of a complete synthetic measurement', () => {
  it('confirms the parity, passes the cancel trial, tallies every slot and leaves the unavailable environment unconfirmed', async () => {
    const analysis = await analyzeGabMeasurement(await sourcesWith(), p2Ports)
    const environment = analysis.environments.find(entry => entry.environment.environmentId === P2_ENVIRONMENT)!
    expect(environment.parity).toMatchObject({ status: 'parity_confirmed', reasonCodes: [], requiredComparisonRuns: 3, completedRequiredRuns: 3, mismatches: [], premiseIssues: [] })
    // timing, rerun x2 (required) and responsiveness, memory (additional): five logical runs, ten Workers.
    expect(environment.parity!.comparedWorkerCount).toBe(10)
    expect(environment.cancelTrials).toHaveLength(1)
    const trial = environment.cancelTrials[0]!
    expect(trial).toMatchObject({ slotId: 't.cancel.1', status: 'cancel_passed', settle: 'cancelled', adoptedResults: 0, settleCount: 1, terminated: true, freshStarted: false, rerun: { slotId: 't.rerun.2', recorded: true, completed: true } })
    // The in-process Worker either sees the cancel at an await (a cooperative `gab_cancelled`) or has already sent its result, which
    // the main thread drops unadopted (C2): both are a passed cancel, and only the second records the dropped result.
    expect(['gab_cancelled', 'ignored_gab_result']).toContain(trial.settledBy)
    expect(trial.ignoredResultAfterCancel).toBe(trial.settledBy === 'ignored_gab_result')
    expect(environment.outcomes).toMatchObject({ plannedSlots: 7, recordedSlots: 7, unrecordedSlots: [], ignoredResultAfterCancel: trial.ignoredResultAfterCancel ? 1 : 0, incomplete: [], unplannedRecords: { count: 0 } })
    expect(environment.order).toEqual({ followed: true, outOfOrderSlots: [] })
    const phone = analysis.environments.find(entry => entry.environment.environmentId === 'phone-test')!
    expect(phone).toMatchObject({ parity: null, cancelTrials: [], outcomes: null })
    expect(analysis.node?.view).not.toBeNull()
    expect(analysis.d1cShaMatchesPlan).toBe(true)
  })

  it('derives a minimized public RESULT that re-derives identically, claims nothing formal and judges no performance', async () => {
    const sources = await sourcesWith()
    const published = await deriveGabPublicResult(sources, p2Ports)
    const again = await deriveGabPublicResult(sources, p2Ports)
    expect(JSON.stringify(again)).toBe(JSON.stringify(published))
    expect(await gabPublicResultIssues(published, sources, p2Ports)).toEqual([])
    const analysis = await analyzeGabMeasurement(sources, p2Ports)
    expect(analysis.identifiers.length).toBeGreaterThan(0)
    const text = JSON.stringify(published)
    for (const identifier of analysis.identifiers) expect(text).not.toContain(identifier)
    expect(published).toMatchObject({ formal: false, verdicts: { performance: 'not_judged', production: 'not_judged', formal: 'not_claimed' } })
    const environment = published.environments.find(entry => entry.environmentId === P2_ENVIRONMENT)!
    expect(environment).toMatchObject({ confirmation: 'measured', parity: { status: 'parity_confirmed' } })
    expect(environment.semanticValues).toMatchObject({ comparedWorkerCount: 10, verificationSemanticSha256s: [node.run.first.verificationSha256], materializationSemanticSha256s: [node.run.first.materializationSha256] })
    expect(environment.semanticValues!.physicalOperations).toBe(node.run.first.verification.physical!.physicalOperations)
    expect(environment.performance!.eligibleSlots).toEqual(['t.timing.1', 't.rerun.1', 't.rerun.2'])
    // Memory the Browser does not expose is recorded as unavailable / not sampled, never estimated.
    expect(environment.memory!.slots[0]!.fixedPoints.every(point => point.status === 'unavailable' && point.bytes === null)).toBe(true)
    expect(environment.memory!.slots[0]).toMatchObject({ cdpWorkerHeap: { status: 'not_sampled' }, osRendererMemory: { status: 'not_sampled' } })
    expect(published.environments.find(entry => entry.environmentId === 'phone-test')).toMatchObject({ confirmation: 'unconfirmed', parity: null, unavailableReason: 'no device in the test' })
    // A changed public RESULT is refused; so is one carrying a record identifier.
    const changed = structuredClone(published)
    changed.environments[0]!.parity!.status = 'parity_mismatch'
    expect((await gabPublicResultIssues(changed, sources, p2Ports)).join(' ')).toMatch(/not the derivation of the sources/)
    expect(gabPublicResultMinimizationIssues({ ...published, leak: analysis.identifiers[0] }, analysis.identifiers).join(' ')).toMatch(/record identifier/)
    expect(gabPublicResultMinimizationIssues({ semantic: {} }, []).join(' ')).toMatch(/Target-level or Plan-level field/)
  })

  it('records an interrupted run: its semantic values are compared, its timings are excluded', async () => {
    const raw = await editRaw(1, value => { value.records[0]!.lifecycle.interrupted = true })
    const published = await deriveGabPublicResult(await sourcesWith({ raw }), p2Ports)
    const environment = published.environments.find(entry => entry.environmentId === P2_ENVIRONMENT)!
    expect(environment.parity!.status).toBe('parity_confirmed')
    expect(environment.performance!.eligibleSlots).toEqual(['t.rerun.1', 't.rerun.2'])
    expect(environment.performance!.excludedSlots).toEqual(['t.timing.1'])
  })
})

describe('P-2 analysis: fail closed on sources it cannot read', () => {
  it('refuses a record of another measurement HEAD, uncommitted benchmark code, a Worker of another build and a malformed raw file', async () => {
    const other = await editRaw(1, value => { value.records[0]!.main.build.commit = '9'.repeat(40) })
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: other }), p2Ports)).rejects.toThrow(/records of another HEAD are never mixed in/)
    const uncommitted = await editRaw(1, value => { value.records[0]!.main.build.uncommittedBenchmarkCode = true })
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: uncommitted }), p2Ports)).rejects.toThrow(/with uncommitted benchmark code/)
    const workerBuild = await editRaw(1, value => { value.records[0]!.first.environment.buildCommit = '9'.repeat(40) })
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: workerBuild }), p2Ports)).rejects.toThrow(/ran another build/)
    const malformed = await editRaw(1, value => { delete (value.records[0] as Record<string, unknown>).lifecycle })
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: malformed }), p2Ports)).rejects.toThrow(GabAnalysisSourceError)
    const notJson = [...measured.raw]
    notJson[0] = await p2SourceFile(notJson[0]!.file, '{"kind":')
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: notJson }), p2Ports)).rejects.toThrow(/is not JSON/)
  })

  it('refuses two raw files that disagree on one record, but reads an identical record saved twice once', async () => {
    const twice = [...measured.raw, measured.raw[1]!]
    const analysis = await analyzeGabMeasurement(await sourcesWith({ raw: twice }), p2Ports)
    expect(analysis.records).toHaveLength(7)
    const disagreeing = await editRaw(1, value => { value.records[0]!.logicalRunWallMs += 1 })
    await expect(analyzeGabMeasurement(await sourcesWith({ raw: [...measured.raw, disagreeing[1]!] }), p2Ports)).rejects.toThrow(/hold different records/)
  })

  it('reads the plan of the measured commit only, and refuses an invalid plan (a lowered required number included)', async () => {
    await expect(analyzeGabMeasurement(await sourcesWith({ planCommit: '8'.repeat(40) }), p2Ports)).rejects.toThrow(/the plan of the measured commit is the only authority/)
    const lowered = world.plan(undefined, value => { value.environments[0]!.requiredComparisonRuns = 2 })
    await expect(analyzeGabMeasurement(await sourcesWith({ plan: lowered }), p2Ports)).rejects.toThrow(/The plan is invalid/)
  })

  it('refuses a malformed driver record and a Node reference without its record file', async () => {
    const driver = await p2SourceFile('driver.json', JSON.stringify({ kind: GAB_DRIVER_RECORD_KIND, revision: 1, measurementHead: '7'.repeat(40) }))
    await expect(analyzeGabMeasurement(await sourcesWith({ driver }), p2Ports)).rejects.toThrow(/driver record/)
    const withoutRecord = { ...node, sources: { ...node.sources, fresh: null } }
    await expect(analyzeGabMeasurement(await sourcesWith({ node: withoutRecord }), p2Ports)).rejects.toThrow(/fresh record fresh\.record\.json was not given/)
  })
})

describe('P-2 analysis: what never enters the comparison population', () => {
  const parityOf = async (sources: GabAnalysisSources) => (await analyzeGabMeasurement(sources, p2Ports)).environments.find(entry => entry.environment.environmentId === P2_ENVIRONMENT)!

  it('a raw semantic record that is not its recorded hash is an integrity issue: the run is not compared and does not count', async () => {
    const raw = await editRaw(1, value => { value.records[0]!.first.settlement.result.verification.semantic.physical.objective += 1 })
    const environment = await parityOf(await sourcesWith({ raw }))
    expect(environment.parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 2, mismatches: [] })
    expect(environment.slots.find(row => row.slot.slotId === 't.timing.1')!.rawIssues.join(' ')).toMatch(/is not its recorded SHA-256/)
  })

  it('a run re-labelled after the fact never takes another slot: the relabelled plan or record leaves the required slot missing', async () => {
    // The timing record claims the pilot purpose: the timing slot stays without a record (it is never filled by the pilot run).
    const relabelled = await editRaw(1, value => { value.records[0]!.slot.purpose = 'pilot' })
    const environment = await parityOf(await sourcesWith({ raw: relabelled }))
    expect(environment.parity).toMatchObject({ status: 'not_comparable', reasonCodes: ['required_runs_incomplete'], completedRequiredRuns: 2 })
    expect(environment.unplanned.map(entry => [entry.slotId, entry.reason])).toEqual([['t.timing.1', 'purpose_mismatch']])
    // An unplanned run (planned: false) is recorded but never compared, even when it agrees.
    const unplanned = await editRaw(1, value => { value.records[0]!.slot.planned = false })
    expect((await parityOf(await sourcesWith({ raw: unplanned }))).unplanned.map(entry => entry.reason)).toEqual(['not_planned'])
  })

  it('external evidence of a lost page counts in the tally and the cancel trial, never as a measurement', async () => {
    const raw = measured.raw.filter((_, index) => index !== 3)
    const driver = await p2SourceFile('driver.json', JSON.stringify({
      kind: GAB_DRIVER_RECORD_KIND, revision: 1, measurementHead: P2_HEAD, driverSha256: '5'.repeat(64),
      launcher: { browser: 'chrome', version: 'test', headless: false, flags: ['--test'], profile: 'dedicated_scratch' }, machine: { cpuModel: 'test', logicalCpuCount: 1, totalMemoryBytes: 1, os: 'test' },
      sessions: [{ sessionId: 's1', origin: 'http://127.0.0.1:1', crossOriginIsolated: false, storageBefore: { indexedDbDatabases: 0, localKeys: 0, sessionKeys: 0, cacheKeys: 0, workerRegistrations: 0 }, storageAfter: { indexedDbDatabases: 0, localKeys: 0, sessionKeys: 0, cacheKeys: 0, workerRegistrations: 0 }, pageLost: true }],
      slots: [
        { slotId: 't.cancel.1', sessionId: 's1', startedAt: 'T', endedAt: null, outcome: 'page_lost', rawFile: null, cpuLoadPercentBefore: 10, external: { kind: 'page_lost', evidence: 'Inspector.targetCrashed' }, cdpWorkerHeap: null, osRendererMemory: null, note: null },
        { slotId: 't.memory.1', sessionId: 's1', startedAt: 'T', endedAt: 'T', outcome: 'record_saved', rawFile: 'x.json', cpuLoadPercentBefore: 10, external: null,
          cdpWorkerHeap: { intervalMs: 500, errors: 0, samples: [{ atMs: 1, role: 'first', usedSize: 10, totalSize: 20 }, { atMs: 2, role: 'first', usedSize: 30, totalSize: 40 }, { atMs: 3, role: 'fresh', usedSize: 5, totalSize: 6 }] },
          osRendererMemory: { intervalMs: 1000, samples: [{ atMs: 1, privateBytes: 100, workingSetBytes: 200, processCount: 1 }] }, note: null },
      ],
    }))
    const sources = await sourcesWith({ raw, driver })
    const analysis = await analyzeGabMeasurement(sources, p2Ports)
    const environment = analysis.environments.find(entry => entry.environment.environmentId === P2_ENVIRONMENT)!
    expect(environment.outcomes).toMatchObject({ recordedSlots: 6, unrecordedSlots: ['t.cancel.1'], external: { page_lost: 1, out_of_memory: 0 } })
    expect(environment.cancelTrials[0]).toMatchObject({ status: 'cancel_not_exercised', reasonCodes: ['record_lost_page_lost'] })
    // The parity is the parity of the required runs only.
    expect(environment.parity!.status).toBe('parity_confirmed')
    const published = await deriveGabPublicResult(sources, p2Ports)
    const memory = published.environments.find(entry => entry.environmentId === P2_ENVIRONMENT)!.memory!.slots[0]!
    expect(memory).toMatchObject({ cdpWorkerHeap: { status: 'sampled', first: { samples: 2, maxSampledUsedBytes: 30 }, fresh: { samples: 1, maxSampledUsedBytes: 5 } }, osRendererMemory: { status: 'sampled', maxSampledPrivateBytes: 100 } })
    expect(published.environments[0]!.storage).toMatchObject({ unchanged: true })
    expect(await gabPublicResultIssues(published, sources, p2Ports)).toEqual([])
  })
})

describe('P-2 analysis: premises and references', () => {
  const statusOf = async (sources: GabAnalysisSources) => (await analyzeGabMeasurement(sources, p2Ports)).environments.find(entry => entry.environment.environmentId === P2_ENVIRONMENT)!.parity!

  it('without a Node reference: not_comparable (node_reference_missing)', async () => {
    expect(await statusOf(await sourcesWith({ node: null }))).toMatchObject({ status: 'not_comparable', reasonCodes: ['node_reference_missing'] })
  })

  it('a Node reference of another HEAD, or whose record is not its hash, is not comparable', async () => {
    const otherHead = await p2NodeReference(world, { output: output => { output.repositoryHeadSha = '6'.repeat(40) } })
    expect((await statusOf(await sourcesWith({ node: otherHead }))).reasonCodes).toEqual(['node_reference_head_mismatch'])
    const tampered = await p2NodeReference(world, { first: record => { (record.verification as Record<string, any>).semantic.physical.objective += 1 } }) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await statusOf(await sourcesWith({ node: tampered }))).reasonCodes).toEqual(['reference_inconsistent'])
  })

  it('detects a D-1C reference that is not the Node one, not the plan\'s SHA-256, or not the accepted RESULT', async () => {
    const otherPlan = await p2D1cResult(world, node, result => { ((result.runs as Record<string, any>[])[0]!.first.verification.planner as Record<string, unknown>).planHash = 'fnv1a32:0000ffff' }) // eslint-disable-line @typescript-eslint/no-explicit-any
    const inconsistent = await statusOf(await sourcesWith({ d1c: otherPlan }))
    expect(inconsistent.reasonCodes).toEqual(['reference_inconsistent'])
    expect(inconsistent.premiseIssues.map(issue => issue.source)).toContain('d1c_result')
    expect((await statusOf(await sourcesWith({ keepPlanD1cSha: true }))).premiseIssues.map(issue => issue.detail).join(' ')).toMatch(/not the SHA-256 the plan fixed/)
    const notAccepted = await p2D1cResult(world, node, result => { (result.acceptance as Record<string, unknown>).status = 'not_accepted' })
    expect((await statusOf(await sourcesWith({ d1c: notAccepted }))).premiseIssues.map(issue => issue.detail).join(' ')).toMatch(/not valid \/ verified \/ accepted/)
  })

  it('an Export identity, CalculationContext or condition that is not the plan\'s is not comparable', async () => {
    const otherExport = world.plan(undefined, value => { value.export = { ...value.export, sha256: 'f'.repeat(64) } })
    expect((await statusOf(await sourcesWith({ plan: otherExport }))).reasonCodes).toEqual(['export_identity_mismatch'])
    const otherContext = world.plan(undefined, value => { value.calculationContext = { ...value.calculationContext, masterDataVersion: 99 } })
    expect((await statusOf(await sourcesWith({ plan: otherContext }))).reasonCodes).toEqual(['calculation_context_mismatch'])
    const sources = await sourcesWith()
    sources.registered = { ...sources.registered, verification: { researchMaxPlanSteps: 1, verificationBudget: 1 } }
    expect((await statusOf(sources)).reasonCodes).toEqual(['conditions_mismatch'])
  })
})

describe('P-2 analysis: the D-1C reader against the real D-1C RESULT shape', () => {
  it('maps a real deriveD1cPublicResult() output to the same values as the raw semantic records it was derived from', async () => {
    const fixture = await d1cFixture()
    const parts = fixture.parts()
    const sources = fixture.sources(parts)
    sources.output.conclusion = concludeD1cMeasurement(fixture.observe(parts))
    const reading = readGabD1cReference(deriveD1cPublicResult(sources))
    const strip = <T extends { semanticKeyHashes: unknown }>(view: T | null) => (view === null ? null : { ...view, semanticKeyHashes: null })
    const first = parts.runs[0]!.first.record!
    const fresh = parts.runs[0]!.fresh!.record!
    expect(reading.view.first.verification).toEqual(strip(gabVerificationViewOfSemantic(first.verification.semantic, first.verification.semanticSha256)))
    expect(reading.view.fresh.verification).toEqual(strip(gabVerificationViewOfSemantic(fresh.verification.semantic, fresh.verification.semanticSha256)))
    expect(reading.view.first.materialization).toEqual(strip(gabMaterializationViewOfSemantic(first.materialization.semantic, first.materialization.semanticSha256)))
    expect(reading.view.first.entryFingerprint).toBe(first.entrySet.entryFingerprint)
    expect(reading.view.first.phase0PlanningTargetCount).toBe(first.phase0PlanningTargetIds.length)
  })

  it('reads the committed D-1C public RESULT as an internally consistent, accepted reference', () => {
    const [text] = Object.values(d1cResultDocs)
    const reading = readGabD1cReference(JSON.parse(text!))
    expect(reading.issues).toEqual([])
    expect(reading.summary).toMatchObject({ formalValidity: 'valid', candidateOutcome: 'verified', acceptance: 'accepted', processCount: 4, planningTargetCount: 43, physicalOperations: 1_766 })
    expect(reading.view.first.materialization).toMatchObject({ verdict: 'all_materialized', candidate: { materialized: 43, materializedBy: { candidate_search_projected: 21, shape_constrained: 22 } } })
    expect(reading.view.first.verification).toMatchObject({ outcomeKind: 'conditions_met', conflictCount: 0, rejectedCount: 0, warningCount: 0, fullPlannerRuns: 1, termination: { status: 'completed', expandedStates: 1_809 } })
    expect(reading.view.fresh.phase0PlanningTargetCount).toBe(43)
  })
})
