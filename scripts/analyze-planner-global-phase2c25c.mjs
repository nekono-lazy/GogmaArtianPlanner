// Issue #154 Phase 2-C2.5-C: post-hoc analysis of one raw run of run-planner-global-phase2c25c.mjs.
//
// Parent (default role): reads the raw run, verifies every raw profile / snapshot against the run's SHA-256 manifest,
// analyzes the sampling profiles in-process and each near-limit snapshot in its own `snapshot-analyzer` child (one at a
// time, 16 GB heap), evaluates the pre-registered hypothesis rules, and writes the committed evidence JSON. It runs no
// Planner and no Search. An analyzer failure is recorded as such, never as "no such object".
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { lstatSync, existsSync, createReadStream } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const sha = value => createHash('sha256').update(value).digest('hex')
const shaFile = path => new Promise((done, fail) => { const h = createHash('sha256'); createReadStream(path).on('data', c => h.update(c)).on('error', fail).on('end', () => done(h.digest('hex'))) })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

async function withModules(paths, body) {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  try {
    const modules = {}
    for (const [name, path] of Object.entries(paths)) modules[name] = await server.ssrLoadModule(path)
    return await body(modules)
  } finally {
    await server.close()
  }
}
const MODULES = {
  c25c: '/src/benchmarks/plannerGlobalPhase2C25C.ts',
  profile: '/src/benchmarks/plannerGlobalPhase2C25CProfileAnalysis.ts',
  snapshot: '/src/benchmarks/plannerGlobalPhase2C25CSnapshotAnalysis.ts',
  analysis: '/src/benchmarks/plannerGlobalPhase2C25CAnalysis.ts',
}

if (role === 'snapshot-analyzer') {
  // ------------------------------------------------------------------ one snapshot per process
  const nearPath = option('--near'), baselinePath = option('--baseline'), outPath = option('--out')
  await withModules({ snapshot: MODULES.snapshot, analysis: MODULES.analysis }, async ({ snapshot, analysis }) => {
    const parse = path => new Promise((done, fail) => {
      const parser = snapshot.createHeapSnapshotStreamParser()
      createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 22 })
        .on('data', chunk => { try { parser.push(chunk) } catch (error) { fail(error) } })
        .on('error', fail).on('end', () => { try { done(parser.finish()) } catch (error) { fail(error) } })
    })
    const timings = {}
    let t = performance.now()
    const baselineGraph = snapshot.buildHeapSnapshotGraph(await parse(baselinePath))
    const baselineMaxNodeId = snapshot.heapSnapshotMaxNodeId(baselineGraph)
    const baselineSummary = { nodeCount: baselineGraph.schema.nodeCount, edgeCount: baselineGraph.schema.edgeCount, maxNodeId: baselineMaxNodeId, sections: baselineGraph.parsed.sections }
    timings.baselineParseMs = performance.now() - t
    t = performance.now()
    const parsed = await parse(nearPath)
    timings.nearParseMs = performance.now() - t
    t = performance.now()
    const graph = snapshot.buildHeapSnapshotGraph(parsed)
    timings.graphMs = performance.now() - t
    t = performance.now()
    const result = snapshot.analyzeHeapSnapshot(graph, {
      baselineMaxNodeId, top: 30, holderGroupsPerEdge: 5, edgeCutHolderGroupsPerEdge: 2,
      edgeGroups: [...analysis.PHASE2C25C_HYPOTHESES.map(h => h.snapshotEdgeGroup), ...analysis.PHASE2C25C_DESCRIPTIVE_EDGE_GROUPS],
      pathSignaturePrefixes: analysis.PHASE2C25C_PATH_SIGNATURE_PREFIXES, persistentRootSignaturePrefixes: analysis.PHASE2C25C_PERSISTENT_ROOT_PREFIXES,
    })
    timings.analysisMs = performance.now() - t
    await writeFile(outPath, JSON.stringify({ completeness: { json: 'complete', sections: parsed.sections, metaResolved: true, nodes: graph.schema.nodeCount, edges: graph.schema.edgeCount,
      strings: parsed.strings.length, header: { node_count: parsed.header.node_count, edge_count: parsed.header.edge_count } }, baseline: baselineSummary, timings,
      analyzerMaxRssKiB: process.resourceUsage().maxRSS, analysis: result }) + '\n', { flag: 'wx' })
  })
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runPath = option('--run'), c25aPath = option('--c25a'), profilesDir = option('--profiles-dir'), snapshotsDir = option('--snapshots-dir'), analysisDir = option('--analysis-dir'), outputPath = option('--output')
if (!runPath || !c25aPath || !profilesDir || !snapshotsDir || !analysisDir || !outputPath) throw new Error('Usage: node scripts/analyze-planner-global-phase2c25c.mjs --run <raw.json.local> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --profiles-dir <dir> --snapshots-dir <dir> --analysis-dir <new dir .local> --output <new.json> [--allow-nonformal]')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const rawRun = await readFile(runPath)
const r = JSON.parse(rawRun.toString('utf8'))
if (r.status !== 'completed') throw new Error(`The raw run did not complete (status ${r.status}).`)
const rawC25A = await readFile(c25aPath)
if (sha(rawC25A) !== r.environment.c25aEvidenceSha256) throw new Error('The raw run selected its workload from another C2.5-A evidence file.')
const formal = r.environment.uncommittedBenchmarkCode === false && r.environment.smoke === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The raw run is not formal (uncommitted code or smoke options).')
const measuredHead = r.environment.repositoryHead
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts').split(/\r?\n/).filter(Boolean)
const postHoc = new Set(['src/benchmarks/plannerGlobalPhase2C25CProfileAnalysis.ts', 'src/benchmarks/plannerGlobalPhase2C25CSnapshotAnalysis.ts', 'src/benchmarks/plannerGlobalPhase2C25CAnalysis.ts',
  'scripts/analyze-planner-global-phase2c25c.mjs'])
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHoc.has(path) && !/\.test\.tsx?$/.test(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
if (existsSync(analysisDir)) throw new Error(`Analysis dir already exists: ${resolve(analysisDir)}`)
await mkdir(analysisDir, { recursive: true })

function verifyManifest(dir, manifest) {
  return (async () => {
    if (!manifest?.present) return { ...manifest, verified: false, reason: 'not_present' }
    const path = join(dir, manifest.file)
    if (!existsSync(path)) return { ...manifest, verified: false, reason: 'missing_on_disk' }
    const actual = await shaFile(path)
    return { ...manifest, verified: actual === manifest.sha256, reason: actual === manifest.sha256 ? null : 'sha256_mismatch' }
  })()
}

function runAnalyzerChild(nearPath, baselinePath, outPath, heapMb) {
  return new Promise(done => {
    let stderrTail = ''
    const started = performance.now()
    const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, 'scripts/analyze-planner-global-phase2c25c.mjs', '--role', 'snapshot-analyzer', '--near', nearPath, '--baseline', baselinePath, '--out', outPath],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-6000) })
    child.once('exit', (code, signal) => done({ code, signal, stderrTail, wallMs: performance.now() - started }))
  })
}

function classifyAnalyzerFailure(exit) {
  if (/JavaScript heap out of memory|Allocation failed|\bOOM\b/.test(exit.stderrTail)) return 'parser_out_of_memory'
  if (/Invalid string length|ERR_STRING_TOO_LONG|Array buffer allocation failed/.test(exit.stderrTail)) return 'file_too_large'
  if (/HeapSnapshotFormatError/.test(exit.stderrTail)) return 'malformed_or_incomplete_snapshot'
  if (/HeapSnapshotSchemaError/.test(exit.stderrTail)) return 'snapshot_schema_mismatch'
  return 'analyzer_process_failure'
}

await withModules(MODULES, async ({ c25c, profile, analysis }) => {
  // ---- sampling profiles
  const scriptTables = new Map()
  const scriptTableOf = async (run) => {
    if (!run.scripts?.present) return null
    if (scriptTables.has(run.scripts.file)) return scriptTables.get(run.scripts.file)
    const verified = await verifyManifest(profilesDir, run.scripts)
    if (!verified.verified) throw new Error(`Script table ${run.scripts.file} failed verification (${verified.reason}).`)
    const table = JSON.parse((await readFile(join(profilesDir, run.scripts.file))).toString('utf8'))
    const byId = new Map(table.map(s => [s.scriptId, s]))
    const consumers = new Map()
    const value = {
      urlOf: id => byId.get(id)?.url ?? null,
      originalPosition: (url, line, column) => {
        const script = table.find(s => s.url === url)
        if (!script?.sourceMap) return null
        let consumer = consumers.get(url)
        if (!consumer) { consumer = new sourceMap.SourceMapConsumer(script.sourceMap); consumers.set(url, consumer) }
        const p = consumer.originalPositionFor({ line: line + 1, column })
        return p.line == null ? null : { line: p.line, column: p.column }
      },
    }
    scriptTables.set(run.scripts.file, value)
    return value
  }
  const trimSite = s => ({ key: s.key, functionName: s.functionName, url: s.url, scriptId: s.scriptId, lineNumber: s.lineNumber, columnNumber: s.columnNumber,
    originalLine: s.originalLine, originalColumn: s.originalColumn, repository: s.repository, category: s.category,
    sampledSelfBytes: Math.round(s.sampledSelfBytes), sampledInclusiveBytes: Math.round(s.sampledInclusiveBytes), selfSamples: s.selfSamples })
  const profileManifest = []
  const samplingRuns = []
  for (const run of r.samplingRuns) {
    const scripts = await scriptTableOf(run)
    const thresholdProfiles = []
    for (const p of run.profiles) {
      const verified = await verifyManifest(profilesDir, p)
      profileManifest.push({ file: p.file, bytes: p.bytes, sha256: p.sha256, verified: verified.verified, runId: run.runId, variant: run.variant, contextKey: `${run.item.orientationId}#${run.item.workIndex}`,
        role: run.item.role, thresholdsMiB: p.thresholdsMiB, heapUsedBytes: p.heapUsedBytes, heapUsedAfterBytes: p.heapUsedAfterBytes, elapsedMs: p.elapsedMs, captureMs: p.captureMs, samples: p.samples,
        node: r.environment.node, v8: r.environment.v8, samplingOptions: run.ready?.samplingOptions ?? null, v8Flags: run.v8Flags })
      if (!verified.verified || scripts === null) continue
      const parsed = profile.validateSamplingHeapProfile(JSON.parse((await readFile(join(profilesDir, p.file))).toString('utf8')))
      const result = profile.analyzeSamplingHeapProfile(parsed, scripts)
      for (const threshold of p.thresholdsMiB) thresholdProfiles.push({ thresholdMiB: threshold, heapUsedBytes: p.heapUsedBytes, elapsedMs: p.elapsedMs, progress: p.progress, analysis: result })
    }
    const growth = profile.comparePhase2C25CThresholds(thresholdProfiles, 15)
    const last = thresholdProfiles.at(-1) ?? null
    const unmappedScriptBytes = last === null ? null : Math.round(last.analysis.callsites.filter(s => s.url === '' && s.scriptId !== '0' && s.functionName !== '' && !['(root)', '(program)', '(garbage collector)', '(idle)'].includes(s.functionName) && s.category === 'runtime' && scripts?.urlOf(s.scriptId) === null).reduce((sum, s) => sum + s.sampledSelfBytes, 0))
    samplingRuns.push({
      runId: run.runId, variant: run.variant, v8Flags: run.v8Flags, contextKey: `${run.item.orientationId}#${run.item.workIndex}`, role: run.item.role, kind: run.item.kind,
      outcome: run.outcome, profilingOutcome: run.profilingOutcome, childOutcome: run.process.childOutcome, exitCode: run.process.exitCode, wallMs: run.process.wallMs,
      preparationMs: run.ready?.preparationMs ?? null, preSearchMemory: run.ready?.preSearchMemory ?? null, heapSizeLimitBytes: run.ready?.heapSizeLimitBytes ?? null,
      samplingOptions: run.ready?.samplingOptions ?? null, profileFailures: run.profileFailures, unannouncedProfiles: run.unannouncedProfiles,
      thresholdsReached: [...new Set(thresholdProfiles.map(p => p.thresholdMiB))], thresholdsNotReached: r.environment.sampling.thresholdsMiB.filter(t => !thresholdProfiles.some(p => p.thresholdMiB === t)),
      lastProgress: run.lastProgress, final: run.final === null ? null : { status: run.final.record.status, searchSummary: run.final.record.searchSummary, firstCandidateKeySha256: run.final.record.firstCandidateKeySha256,
        elapsedMs: run.final.record.elapsedMs, profilingEvents: run.final.profilingEvents, progress: run.final.progress },
      control: run.control,
      thresholds: thresholdProfiles.map(p => ({ thresholdMiB: p.thresholdMiB, heapUsedBytes: p.heapUsedBytes, elapsedMs: p.elapsedMs, progress: p.progress,
        totalSampledBytes: Math.round(p.analysis.totalSampledBytes), totalSamples: p.analysis.totalSamples, repositorySelfBytes: Math.round(p.analysis.repositorySelfBytes),
        categories: p.analysis.categories.map(c => ({ ...c, sampledSelfBytes: Math.round(c.sampledSelfBytes) })) })),
      growth,
      top: last === null ? null : {
        thresholdMiB: last.thresholdMiB,
        allCallsites: last.analysis.callsites.slice(0, 30).map(trimSite),
        repositoryCallsites: last.analysis.callsites.filter(s => s.repository).slice(0, 30).map(trimSite),
        attributedRepositoryCallsites: last.analysis.attributedCallsites.filter(s => s.repository).slice(0, 30).map(trimSite),
        totalSampledBytes: Math.round(last.analysis.totalSampledBytes), repositorySelfBytes: Math.round(last.analysis.repositorySelfBytes), unmappedScriptBytes,
      },
      lastAnalysis: last === null ? null : { thresholdMiB: last.thresholdMiB, analysis: last.analysis },
    })
  }

  // ---- heap snapshots, one analyzer process each
  const snapshotRuns = []
  for (const run of r.snapshotRuns) {
    const dir = join(snapshotsDir, run.diagnosticDir)
    const baseline = run.baseline === null ? null : await verifyManifest(dir, run.baseline)
    const near = []
    for (const s of run.nearLimitSnapshots) near.push(await verifyManifest(dir, s))
    let analyzed = null, analyzer = null, snapshotState
    const usable = near.filter(s => s.verified && s.writtenAfterSearchStart)
    if (near.length === 0) snapshotState = 'not_written'
    else if (usable.length === 0) snapshotState = near.some(s => !s.writtenAfterSearchStart) ? 'written_before_search' : 'partial'
    else if (baseline?.verified !== true) snapshotState = 'partial'
    if (usable.length > 0 && baseline?.verified === true) {
      const outPath = join(analysisDir, `${run.runId}.analysis.json`)
      const exit = await runAnalyzerChild(join(dir, usable[0].file), join(dir, baseline.file), outPath, c25c.PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB)
      if (exit.code === 0 && existsSync(outPath)) {
        analyzed = JSON.parse((await readFile(outPath)).toString('utf8'))
        analyzer = { outcome: 'analyzed', wallMs: exit.wallMs, heapLimitMb: c25c.PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB }
        snapshotState = 'complete'
      } else {
        const failure = classifyAnalyzerFailure(exit)
        analyzer = { outcome: 'analyzer_failed', failure, exitCode: exit.code, wallMs: exit.wallMs, stderrTail: exit.stderrTail.slice(-2000), heapLimitMb: c25c.PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB }
        snapshotState = failure === 'malformed_or_incomplete_snapshot' ? 'partial' : 'complete_unanalyzed'
      }
      console.log(`${run.runId}: ${analyzer.outcome} ${(exit.wallMs / 1000).toFixed(1)}s`)
    }
    const searchStatus = run.final?.record.status ?? null
    const classified = c25c.classifyPhase2C25CRun({ kind: 'snapshot', childOutcome: run.process.childOutcome, searchStatus,
      snapshot: snapshotState === 'complete' || snapshotState === 'complete_unanalyzed' ? 'complete' : snapshotState })
    snapshotRuns.push({ runId: run.runId, contextKey: `${run.item.orientationId}#${run.item.workIndex}`, kind: run.item.kind, childOutcome: run.process.childOutcome, exitCode: run.process.exitCode,
      wallMs: run.process.wallMs, nodeFlags: run.process.nodeFlags, ...classified, snapshotState, analyzer,
      ready: run.ready, baseline: baseline === null ? null : { file: baseline.file, bytes: baseline.bytes, sha256: baseline.sha256, verified: baseline.verified, writeMs: run.baseline.writeMs,
        memoryAfter: run.baseline.memoryAfter, maxNodeId: analyzed?.baseline.maxNodeId ?? null, nodeCount: analyzed?.baseline.nodeCount ?? null },
      nearLimitSnapshots: near.map(s => ({ file: s.file, bytes: s.bytes, sha256: s.sha256, verified: s.verified, writtenAfterSearchStart: s.writtenAfterSearchStart, tailLooksComplete: s.tailLooksComplete,
        writeStartedAt: s.birthtimeMs, writeFinishedAt: s.mtimeMs, searchStartedAt: run.searchStartedAt, lastProgressBeforeWrite: s.lastProgressBeforeWrite })),
      lastProgress: run.lastProgress, completeness: analyzed?.completeness ?? null, timings: analyzed?.timings ?? null, analyzerMaxRssKiB: analyzed?.analyzerMaxRssKiB ?? null,
      analysis: analyzed?.analysis ?? null })
  }

  // ---- hypotheses over the OOM representatives
  const oomKeys = r.workload.oomRepresentatives.map(i => `${i.orientationId}#${i.workIndex}`)
  const lastOf = (variant, key) => { const run = samplingRuns.find(s => s.variant === variant && s.contextKey === key); return run?.lastAnalysis ?? null }
  const hypotheses = analysis.evaluatePhase2C25CHypotheses(oomKeys.map(key => ({ contextKey: key, snapshot: snapshotRuns.find(s => s.contextKey === key)?.analysis ?? null,
    sampling: { no_inlining: lastOf('no_inlining', key), jit_default: lastOf('jit_default', key) } })))

  const samplingSummary = run => run?.lastAnalysis == null ? null : { thresholdMiB: run.lastAnalysis.thresholdMiB, totalSampledBytes: run.lastAnalysis.analysis.totalSampledBytes,
    repositorySelfBytes: run.lastAnalysis.analysis.repositorySelfBytes, categories: run.lastAnalysis.analysis.categories,
    attributedRepositoryCallsites: run.lastAnalysis.analysis.attributedCallsites.filter(s => s.repository).slice(0, 30) }
  const findings = analysis.buildPhase2C25CFindings(r.workload.oomRepresentatives.map(item => {
    const key = `${item.orientationId}#${item.workIndex}`
    const jit = samplingRuns.find(s => s.variant === 'jit_default' && s.contextKey === key)
    const snap = snapshotRuns.find(s => s.contextKey === key)?.analysis ?? null
    const resultNode = snap === null ? null : [...snap.topNewSignaturesByShallowSize, ...snap.topNewSignaturesByCount].find(g => g.key === analysis.PHASE2C25C_HOLDER_SIGNATURES.reservedBonusResultNode)
    return { contextKey: key, kind: item.kind, gogmaMaxDepthAtLastProgress: jit?.lastProgress?.progress?.maxDepth?.gogma ?? null,
      sampling: { jit_default: samplingSummary(jit), no_inlining: samplingSummary(samplingRuns.find(s => s.variant === 'no_inlining' && s.contextKey === key)) },
      snapshot: snap === null ? null : { newReachableBytes: snap.reachableFromRoot.newSize, persistentNewBytes: snap.persistentSplit?.reachableFromRoots.newSize ?? null,
        groupCutNewBytes: Object.fromEntries(snap.groupEdgeCuts.map(g => [g.group, g.edgeCut.newSize])), reservedBonusResultNodeShallowBytes: resultNode?.shallowSize ?? 0 } }
  }), hypotheses)

  const evidence = {
    phase: 'Issue #154 Phase 2-C2.5-C: heap profiling of the Search-only OOM (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: { file: basename(runPath), bytes: rawRun.length, sha256: sha(rawRun) }, c25a: { file: basename(c25aPath), sha256: sha(rawC25A) } },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c25aEvidenceFileName: r.environment.c25aEvidenceFileName, c25aEvidenceSha256: r.environment.c25aEvidenceSha256, c25aMeasuredHead: r.environment.c25aMeasuredHead,
      c25bEvidenceFileName: r.environment.c25bEvidenceFileName, c25bEvidenceSha256: r.environment.c25bEvidenceSha256,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
      environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
        osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    },
    conditions: {
      concurrency: r.environment.concurrency, freshChildPerRun: true, samplingAndSnapshotInSeparateChildren: true, nodeYield: r.environment.nodeYield,
      searchExtent: r.environment.searchExtent, candidateStopBound: r.environment.candidateStopBound, calculationContext: r.environment.calculationContext,
      researchMaxPlanSteps: r.environment.researchMaxPlanSteps, sampling: r.environment.sampling, snapshot: { ...r.environment.snapshot, analyzerHeapLimitMb: c25c.PHASE2C25C_SNAPSHOT_ANALYZER_HEAP_MB, analyzerConcurrency: 1 },
      progressHeartbeatMs: r.environment.progressHeartbeatMs, runBudgetMs: r.environment.runBudgetMs, instrumentation: 'held-aware depth hooks reduced to counters (createPhase2C25CProgressObserver); no counting Engine',
      oracleUsed: false,
    },
    samplingOptionProbe: r.probe,
    workload: { rule: r.workload.rule, oomRepresentatives: r.workload.oomRepresentatives.map(({ expected, ...rest }) => ({ ...rest, c25aStatus: expected.status })),
      controls: r.workload.controls.map(({ expected, ...rest }) => ({ ...rest, c25aStatus: expected.status, c25aSearchSummary: expected.searchSummary, c25aFirstCandidateKeySha256: expected.firstCandidateKeySha256 })) },
    contextParity: { contexts: r.parity.length, matching: r.parity.filter(p => p.matches).length, rows: r.parity },
    profilerContamination: { controls: samplingRuns.filter(s => s.control !== null).map(s => ({ runId: s.runId, variant: s.variant, ...s.control })),
      contaminated: samplingRuns.filter(s => s.control?.contaminated).length },
    samplingRuns: samplingRuns.map(({ lastAnalysis: _last, ...rest }) => rest),
    profileManifest,
    snapshotRuns: snapshotRuns.map(({ analysis: a, ...rest }) => ({ ...rest, summary: a === null ? null : {
      terminology: a.terminology, nodeCount: a.nodeCount, edgeCount: a.edgeCount, totalShallowSize: a.totalShallowSize, reachableFromRoot: a.reachableFromRoot,
      baselineMaxNodeId: a.baselineMaxNodeId, newNodeCount: a.newNodeCount, newShallowSize: a.newShallowSize,
      topByShallowSize: a.topByShallowSize.slice(0, 20), topByCount: a.topByCount.slice(0, 20),
      topNewSignaturesByShallowSize: a.topNewSignaturesByShallowSize, topNewSignaturesByCount: a.topNewSignaturesByCount.slice(0, 20),
      targetedEdges: a.targetedEdges, groupEdgeCuts: a.groupEdgeCuts, retainingPathExamples: a.retainingPathExamples, persistentSplit: a.persistentSplit } })),
    hypothesisRule: analysis.PHASE2C25C_VERDICT_RULE,
    hypotheses,
    findings,
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, sampling: samplingRuns.map(s => `${s.runId}: ${s.outcome}/${s.profilingOutcome} t=${s.thresholdsReached.join(',')}`),
    snapshots: snapshotRuns.map(s => `${s.runId}: ${s.outcome} ${s.snapshotState}`), hypotheses: hypotheses.map(h => `${h.id}:${h.verdict}`),
    contamination: evidence.profilerContamination.contaminated }, null, 2))
})
