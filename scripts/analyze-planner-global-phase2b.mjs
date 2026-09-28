// Issue #154 Phase 2-B Research only: POST-HOC analysis of finished runs. Every input is an explicit evidence file:
// the Phase 2-B Browser export (autonomous runs, timing / responsiveness / memory), the external CDP memory samples,
// the Node runs, and the committed Phase 2-A.5 result JSON (proven minimum). It runs no Search and no Planner, and
// it never feeds the optimum evidence into anything but this comparison.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const EXPECTED_SEMANTIC_SHA256 = 'b8ac8bdf4af43224df2947067c13c23113b6c994388fabbc29cd4e992a00a9f8'
const EXPECTED_EXPORT_SHA256 = 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b'
const HISTORICAL_VALIDATED_ORACLE = 2982
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { browser: option('--browser'), externalMemory: option('--external-memory'), node: option('--node'), nodeGc: option('--node-gc'),
  optimum: option('--optimum'), output: option('--output') }
if (!paths.browser || !paths.optimum || !paths.output) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2b.mjs --browser <export.json> --optimum <PLANNER_GLOBAL_1657_ORACLE_RESULT.json> --output <new.json> [--external-memory <cdp.json>] [--node <node.json>] [--node-gc <node-gc.json>]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const load = async path => { const text = await readFile(path, 'utf8'); return { json: JSON.parse(text), source: { file: basename(path), bytes: Buffer.byteLength(text), sha256: sha(text) } } }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const gap = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2BGapAnalysis.ts')
  const perf = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2BPerformance.ts')
  const timeline = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2BTimeline.ts')
  const runner = await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const browser = await load(paths.browser), optimumFile = await load(paths.optimum)
  const external = paths.externalMemory ? await load(paths.externalMemory) : null
  const node = paths.node ? await load(paths.node) : null, nodeGc = paths.nodeGc ? await load(paths.nodeGc) : null
  const env = browser.json.environment
  if (env.exportInfo?.sha256 !== EXPECTED_EXPORT_SHA256) throw new Error('Browser export was not measured on the Phase 1-2 Export.')
  const records = browser.json.records.filter(record => record.config.phase2b)
  if (records.length === 0) throw new Error('No Phase 2-B record in the Browser export.')
  const completed = records.filter(record => record.status === 'completed')

  // Semantics: every Phase 2-B run reproduces the Phase 2-A semantic result, and every Plan evidence is identical.
  const planEvidenceSha = record => sha(JSON.stringify(record.result.phase2b.autonomousPlan))
  const semantics = completed.map(record => ({ id: record.id, label: record.label, kind: record.kind, semanticSha256: record.result.semanticSha256,
    matchesPhase2A: record.result.semanticSha256 === EXPECTED_SEMANTIC_SHA256, planSha256: record.result.evidence.planSha256,
    autonomousPlanEvidenceSha256: planEvidenceSha(record), final: { ...record.result.report.final, elapsedMs: undefined, warnings: record.result.report.final?.warnings.length } }))
  const nodeSemantics = [node, nodeGc].filter(Boolean).map(run => ({ file: run.source.file, semanticSha256: run.json.result.semanticSha256,
    matchesPhase2A: run.json.result.semanticSha256 === EXPECTED_SEMANTIC_SHA256, autonomousPlanEvidenceSha256: sha(JSON.stringify(run.json.result.phase2b.autonomousPlan)) }))
  const evidenceHashes = new Set([...semantics, ...nodeSemantics].map(row => row.autonomousPlanEvidenceSha256))
  if (semantics.some(row => !row.matchesPhase2A) || nodeSemantics.some(row => !row.matchesPhase2A)) throw new Error('A Phase 2-B run changed the Phase 2-A semantic result.')
  if (evidenceHashes.size !== 1) throw new Error('Autonomous Plan evidence differs between runs.')

  // Gap: the finished autonomous Plan against the committed proven-minimum evidence.
  const optimum = gap.parseOptimumEvidence(optimumFile.json)
  if (optimum.verdict !== 'proven_minimum' || optimum.exportSha256 !== EXPECTED_EXPORT_SHA256) throw new Error('Optimum evidence is not the proven minimum of this Export.')
  const analysis = gap.analyzePhase2BGap(completed[0].result.phase2b.autonomousPlan, optimum, HISTORICAL_VALIDATED_ORACLE)

  // Timing: the measurement records (warm-up excluded), median per phase.
  const timingRecords = completed.filter(record => record.kind === 'measurement')
  const byKindOf = record => perf.summarizePlannerCallsByKind(record.result.phase2b.timeline)
  const finalPhasesOf = record => timeline.phase2bCallPhaseDurations(record.result.phase2b.timeline.find(call => call.kind === 'final'))
  const med = values => perf.medianOf(values)
  const phaseNames = timeline.PHASE2B_CALL_PHASES
  const timing = {
    records: timingRecords.map(record => ({ id: record.id, roundTripMs: record.roundTripMs, calculationElapsedMs: record.result.timing.calculationElapsedMs,
      searchElapsedMs: record.result.timing.searchElapsedMs, plannerElapsedMs: record.result.timing.plannerElapsedMs, evidenceElapsedMs: record.result.timing.evidenceElapsedMs,
      planEvidenceElapsedMs: record.result.phase2b.planEvidenceElapsedMs, byKind: byKindOf(record), finalPhasesMs: finalPhasesOf(record),
      finalTailSync: perf.finalCallTailSyncMs(record.result.phase2b.timeline.find(call => call.kind === 'final')) })),
  }
  timing.median = {
    roundTripMs: med(timing.records.map(r => r.roundTripMs)), calculationElapsedMs: med(timing.records.map(r => r.calculationElapsedMs)),
    searchElapsedMs: med(timing.records.map(r => r.searchElapsedMs)), plannerElapsedMs: med(timing.records.map(r => r.plannerElapsedMs)),
    finalPhasesMs: Object.fromEntries(phaseNames.map(phase => [phase, med(timing.records.map(r => r.finalPhasesMs[phase]))])),
    byKind: ['baseline', 'retained_prefix', 'application', 'final'].map(kind => {
      const rows = timing.records.map(r => r.byKind.find(k => k.kind === kind))
      return { kind, calls: rows[0].calls, elapsedMs: med(rows.map(k => k.elapsedMs)), maxSchedulerSyncSegmentMs: med(rows.map(k => k.maxSchedulerSyncSegmentMs)),
        phasesMs: Object.fromEntries(phaseNames.map(phase => [phase, med(rows.map(k => k.phasesMs[phase]))])) }
    }),
    finalTailSyncMs: med(timing.records.map(r => r.finalTailSync?.durationMs ?? 0)),
  }

  // Responsiveness.
  const responsivenessRecord = completed.find(record => record.kind === 'responsiveness')
  const responsiveness = responsivenessRecord ? {
    id: responsivenessRecord.id, ping: { ...responsivenessRecord.ping, samplesMs: undefined }, acceptedClockCheckMs: responsivenessRecord.phase2b.acceptedClockCheckMs,
    thresholdMs: responsivenessRecord.phase2b.ping.thresholdMs, slowPingCount: responsivenessRecord.phase2b.ping.slowPings.length,
    slowest: responsivenessRecord.phase2b.ping.slowest,
    slowPings: [...responsivenessRecord.phase2b.ping.slowPings].sort((a, b) => b.rttMs - a.rttMs).slice(0, 30),
    finalPhasesMs: finalPhasesOf(responsivenessRecord), finalTailSync: perf.finalCallTailSyncMs(responsivenessRecord.result.phase2b.timeline.find(call => call.kind === 'final')),
  } : null

  // Memory: external CDP Worker heap samples mapped onto the memory record's Worker intervals.
  const memoryRecord = completed.find(record => record.kind === 'memory')
  let memory = null
  if (memoryRecord) {
    const intervals = runner.phase2bWorkerIntervals(memoryRecord.result)
    const samples = external ? external.json.workerHeap.map(sample => ({ atMs: sample.atEpochMs + external.json.clock.workerMinusDriverMs, usedBytes: sample.usedSize })) : []
    const finalCall = memoryRecord.result.phase2b.timeline.find(call => call.kind === 'final')
    const finalIntervals = intervals.filter(interval => interval.name.startsWith(`final#${finalCall.index}:`) || interval.name.startsWith('worker:'))
    const marks = memoryRecord.result.phase2b.marks
    memory = { id: memoryRecord.id, pageFixedPoints: memoryRecord.memory, acceptedClockCheckMs: memoryRecord.phase2b.acceptedClockCheckMs,
      external: external ? { source: external.source, sampleCount: samples.length, intervalMs: external.json.intervalMs, scope: external.json.scope, clock: external.json.clock,
        maxSampledBytes: samples.length ? Math.max(...samples.map(s => s.usedBytes)) : null,
        finalCall: perf.attributeHeapSamples(samples, finalIntervals),
        byStage: perf.attributeHeapSamples(samples, [
          { name: 'calculation', startMs: marks.calculationStartAtMs, endMs: marks.calculationEndAtMs },
          { name: 'final_call', startMs: finalCall.marks[0].atMs, endMs: finalCall.marks.at(-1).atMs },
          { name: 'after_calculation', startMs: marks.calculationEndAtMs, endMs: marks.resultPostAtMs }]),
        os: external.json.os ?? null } : null,
      finalPhasesMs: finalPhasesOf(memoryRecord) }
  }

  const nodeSummary = run => run && { source: run.source, environment: run.json.environment, wallMs: run.json.wallMs, heapProbe: run.json.result.phase2b.heapProbe,
    byKind: perf.summarizePlannerCallsByKind(run.json.result.phase2b.timeline),
    finalMarks: run.json.result.phase2b.timeline.find(call => call.kind === 'final').marks }

  const output = {
    phase: 'Issue #154 Global Planner Research Phase 2-B: decomposition of the Plan quality gap and of the final Planner performance',
    analyzedAt: new Date().toISOString(),
    sources: { browser: browser.source, optimum: optimumFile.source, externalMemory: external?.source ?? null, node: node?.source ?? null, nodeGc: nodeGc?.source ?? null },
    browserEnvironment: env,
    expected: { exportSha256: EXPECTED_EXPORT_SHA256, phase2aSemanticSha256: EXPECTED_SEMANTIC_SHA256, historicalValidatedOracle: HISTORICAL_VALIDATED_ORACLE },
    semantics: { browser: semantics, node: nodeSemantics, autonomousPlanEvidenceSha256: [...evidenceHashes][0] },
    gap: analysis,
    performance: { timing, responsiveness, memory, node: nodeSummary(node), nodeGc: nodeSummary(nodeGc) },
  }
  await writeFile(paths.output, JSON.stringify(output, null, 1) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), totals: analysis.totals, timingMedian: { ...timing.median, byKind: undefined } }, null, 2))
} finally {
  await server.close()
}
process.exit(process.exitCode ?? 0)
