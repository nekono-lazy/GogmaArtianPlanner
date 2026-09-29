// Issue #154 Phase 2-C2.5-D2-c: post-hoc analysis of one raw run of run-planner-global-phase2c25d2c.mjs.
//
// Parent (default role): reads the raw run, fails closed unless the pre-registered D2-c rules are byte-for-byte the rules
// the run recorded (SHA-256 of stableStringify(PHASE2C25D2C_RULES)), verifies every raw profile / snapshot against the
// run's SHA-256 manifest, analyzes the sampling profiles in-process and each near-limit snapshot in its own
// `snapshot-analyzer` child (one at a time, 16 GB heap), re-analyzes the old Phase 2-C2.5-C raw artifacts of the same
// contexts with the same D2-c rules (after verifying them against the committed C2.5-C RESULT manifest), evaluates the
// pre-registered rules and writes the committed evidence JSON. It runs no Planner and no Search. An analyzer failure is
// recorded as such, never as "no such object".
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
  d2c: '/src/benchmarks/plannerGlobalPhase2C25D2C.ts',
  analysis: '/src/benchmarks/plannerGlobalPhase2C25D2CAnalysis.ts',
  interpretation: '/src/benchmarks/plannerGlobalPhase2C25D2CInterpretation.ts',
  profile: '/src/benchmarks/plannerGlobalPhase2C25CProfileAnalysis.ts',
  snapshot: '/src/benchmarks/plannerGlobalPhase2C25CSnapshotAnalysis.ts',
  hashing: '/src/domain/models/hashing.ts',
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
    const baselineParsed = await parse(baselinePath)
    const baselineGraph = snapshot.buildHeapSnapshotGraph(baselineParsed)
    const baselineMaxNodeId = snapshot.heapSnapshotMaxNodeId(baselineGraph)
    const baselineSummary = { nodeCount: baselineGraph.schema.nodeCount, edgeCount: baselineGraph.schema.edgeCount, maxNodeId: baselineMaxNodeId, sections: baselineParsed.sections,
      strings: baselineParsed.strings.length, header: { node_count: baselineParsed.header.node_count, edge_count: baselineParsed.header.edge_count } }
    timings.baselineParseMs = performance.now() - t
    t = performance.now()
    const parsed = await parse(nearPath)
    timings.nearParseMs = performance.now() - t
    t = performance.now()
    const graph = snapshot.buildHeapSnapshotGraph(parsed)
    timings.graphMs = performance.now() - t
    t = performance.now()
    const result = analysis.analyzePhase2C25D2CSnapshot(graph, { baselineMaxNodeId, top: 30 })
    timings.analysisMs = performance.now() - t
    await writeFile(outPath, JSON.stringify({ completeness: { json: 'complete', sections: parsed.sections, metaResolved: true, nodes: graph.schema.nodeCount, edges: graph.schema.edgeCount,
      strings: parsed.strings.length, header: { node_count: parsed.header.node_count, edge_count: parsed.header.edge_count },
      nodeCountMatchesHeader: parsed.header.node_count === graph.schema.nodeCount, edgeCountMatchesHeader: parsed.header.edge_count === graph.schema.edgeCount },
      baseline: baselineSummary, timings, analyzerMaxRssKiB: process.resourceUsage().maxRSS, analysis: result }) + '\n', { flag: 'wx' })
  })
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runPath = option('--run'), d2aPath = option('--d2a'), profilesDir = option('--profiles-dir'), snapshotsDir = option('--snapshots-dir')
const analysisDir = option('--analysis-dir'), outputPath = option('--output')
const oldResultPath = option('--c25c'), oldRunPath = option('--c25c-run'), oldProfilesDir = option('--c25c-profiles-dir'), oldSnapshotsDir = option('--c25c-snapshots-dir')
if (!runPath || !d2aPath || !profilesDir || !snapshotsDir || !analysisDir || !outputPath || !oldResultPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c25d2c.mjs --run <raw.json.local> --d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --c25c docs/PLANNER_GLOBAL_PHASE2C25C_RESULT.json ' +
    '--profiles-dir <dir> --snapshots-dir <dir> --analysis-dir <new dir .local> --output <new.json> [--c25c-run <old raw.json.local> --c25c-profiles-dir <dir> --c25c-snapshots-dir <dir>] [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const rawRun = await readFile(runPath)
const r = JSON.parse(rawRun.toString('utf8'))
if (r.status !== 'completed') throw new Error(`The raw run did not complete (status ${r.status}).`)
const rawD2A = await readFile(d2aPath)
if (sha(rawD2A) !== r.environment.d2aResultSha256) throw new Error('The raw run selected its workload from another D2-a RESULT.')
const rawOldResult = await readFile(oldResultPath)
if (sha(rawOldResult) !== r.environment.c25cResultSha256) throw new Error('The raw run recorded another C2.5-C RESULT.')
const oldResult = JSON.parse(rawOldResult.toString('utf8'))
const formal = r.environment.uncommittedBenchmarkCode === false && r.environment.smoke === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The raw run is not formal (uncommitted code or smoke options).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
// Working tree against the measured HEAD, so an uncommitted change counts too.
const changed = git('diff', '--name-only', measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...codePaths).split(/\r?\n/).filter(Boolean)
/**
 * Post-hoc files: the analyzer (reporting only), the interpretation written after the evidence, and tests. The analysis
 * layer (every measure and rule) is NOT post-hoc: any change to it after the measured HEAD fails closed, and its
 * pre-registered rules are additionally checked by digest below.
 */
const POST_HOC = new Set(['scripts/analyze-planner-global-phase2c25d2c.mjs', 'src/benchmarks/plannerGlobalPhase2C25D2CInterpretation.ts'])
const calculationCodeChangedSinceMeasuredHead = [...changed, ...untracked].filter(path => !POST_HOC.has(path) && !/\.test\.tsx?$/.test(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && formal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
if (existsSync(analysisDir)) throw new Error(`Analysis dir already exists: ${resolve(analysisDir)}`)
await mkdir(analysisDir, { recursive: true })

function verifyManifest(dir, manifest) {
  return (async () => {
    if (!manifest?.present && manifest?.present !== undefined) return { ...manifest, verified: false, reason: 'not_present' }
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
    const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, 'scripts/analyze-planner-global-phase2c25d2c.mjs', '--role', 'snapshot-analyzer', '--near', nearPath, '--baseline', baselinePath, '--out', outPath],
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

const round = n => n === null || n === undefined ? n : Math.round(n)
const pct = v => v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`

await withModules(MODULES, async ({ d2c, analysis, interpretation, profile, hashing }) => {
  const rulesSha256 = sha(hashing.stableStringify(analysis.PHASE2C25D2C_RULES))
  if (rulesSha256 !== r.environment.rulesSha256) throw new Error(`The pre-registered D2-c rules changed since the measured run (${rulesSha256} != ${r.environment.rulesSha256}).`)
  const heapMb = d2c.PHASE2C25D2C_SNAPSHOT_ANALYZER_HEAP_MB

  // ---- script tables (source maps) for sampling profiles
  const scriptTables = new Map()
  const scriptTableOf = async (dir, manifest) => {
    if (!manifest) return null
    const key = join(dir, manifest.file)
    if (scriptTables.has(key)) return scriptTables.get(key)
    const verified = await verifyManifest(dir, manifest)
    if (!verified.verified) throw new Error(`Script table ${manifest.file} failed verification (${verified.reason}).`)
    const table = JSON.parse((await readFile(key)).toString('utf8'))
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
    scriptTables.set(key, value)
    return value
  }
  const trimSite = (s, total) => ({ key: s.key, functionName: s.functionName, url: s.url, originalLine: s.originalLine, repository: s.repository,
    sampledSelfBytes: Math.round(s.sampledSelfBytes), share: total === 0 ? 0 : s.sampledSelfBytes / total })
  const summarizeProfile = (result) => ({
    totalSampledBytes: Math.round(result.totalSampledBytes), totalSamples: result.base.totalSamples, repositorySelfBytes: Math.round(result.base.repositorySelfBytes),
    categories: result.categories.map(c => ({ ...c, sampledSelfBytes: Math.round(c.sampledSelfBytes) })),
    topAttributedRepositoryCallsites: result.base.attributedCallsites.filter(s => s.repository).slice(0, 20).map(s => trimSite(s, result.totalSampledBytes)),
    topRawRepositoryCallsites: result.base.callsites.filter(s => s.repository).slice(0, 15).map(s => trimSite(s, result.totalSampledBytes)),
    topInclusive: result.inclusive.slice(0, 25).map(i => ({ ...i, sampledInclusiveBytes: Math.round(i.sampledInclusiveBytes) })),
  })

  /** Analyzes the verified profiles of one sampling run (post-D2 or old C2.5-C). */
  async function analyzeSamplingRun({ dir, run, profilesManifest, scriptsManifest, verifyAgainst }) {
    const scripts = await scriptTableOf(dir, scriptsManifest)
    const thresholds = []
    const manifest = []
    for (const p of profilesManifest) {
      const expected = verifyAgainst ? verifyAgainst(p) : p
      const verified = await verifyManifest(dir, { file: p.file, sha256: expected?.sha256, present: true })
      manifest.push({ file: p.file, bytes: p.bytes, sha256: p.sha256, verified: verified.verified && expected !== null, thresholdsMiB: p.thresholdsMiB, heapUsedBytes: p.heapUsedBytes,
        heapUsedAfterBytes: p.heapUsedAfterBytes, elapsedMs: p.elapsedMs, captureMs: p.captureMs, samples: p.samples })
      if (!verified.verified || expected === null || scripts === null) continue
      const parsed = profile.validateSamplingHeapProfile(JSON.parse((await readFile(join(dir, p.file))).toString('utf8')))
      const result = analysis.analyzePhase2C25D2CProfile(parsed, scripts)
      for (const thresholdMiB of p.thresholdsMiB) thresholds.push({ thresholdMiB, heapUsedBytes: p.heapUsedBytes, elapsedMs: p.elapsedMs, progress: p.progress ?? null, result })
    }
    thresholds.sort((a, b) => a.thresholdMiB - b.thresholdMiB)
    const last = thresholds.at(-1) ?? null
    return {
      manifest,
      thresholds: thresholds.map(t => ({ thresholdMiB: t.thresholdMiB, heapUsedBytes: t.heapUsedBytes, elapsedMs: t.elapsedMs,
        progress: t.progress === null ? null : { maxDepth: t.progress.maxDepth, cumulative: t.progress.cumulative, lastEvent: t.progress.lastEvent, gogmaDepthMaxima: t.progress.gogmaDepthMaxima ?? null },
        totalSampledBytes: Math.round(t.result.totalSampledBytes), categories: t.result.categories.map(c => ({ category: c.category, share: c.share })) })),
      last: last === null ? null : { thresholdMiB: last.thresholdMiB, heapUsedBytes: last.heapUsedBytes, summary: summarizeProfile(last.result), analysis: last.result },
    }
  }

  // ---- post-D2 sampling
  const samplingRuns = []
  const profileManifest = []
  for (const run of r.samplingRuns) {
    const analyzed = await analyzeSamplingRun({ dir: profilesDir, run, profilesManifest: run.profiles, scriptsManifest: run.scripts?.present ? run.scripts : null })
    profileManifest.push(...analyzed.manifest.map(m => ({ ...m, runId: run.runId, variant: run.variant, contextKey: `${run.item.orientationId}#${run.item.workIndex}`, role: run.item.role,
      node: r.environment.node, v8: r.environment.v8, profilerOptions: run.ready?.samplingOptions ?? null, v8Flags: run.v8Flags })))
    samplingRuns.push({
      runId: run.runId, variant: run.variant, v8Flags: run.v8Flags, contextKey: `${run.item.orientationId}#${run.item.workIndex}`, role: run.item.role, kind: run.item.kind,
      outcome: run.outcome, profilingOutcome: run.profilingOutcome, childOutcome: run.process.childOutcome, exitCode: run.process.exitCode, wallMs: run.process.wallMs,
      preparationMs: run.ready?.preparationMs ?? null, preSearchMemory: run.ready?.preSearchMemory ?? null, heapSizeLimitBytes: run.ready?.heapSizeLimitBytes ?? null,
      samplingOptions: run.ready?.samplingOptions ?? null, profileFailures: run.profileFailures, unannouncedProfiles: run.unannouncedProfiles, thresholdStatus: run.thresholdStatus,
      lastProgress: run.lastProgress === null ? null : { elapsedMs: run.lastProgress.elapsedMs, memory: run.lastProgress.memory, maxDepth: run.lastProgress.progress.maxDepth,
        cumulative: run.lastProgress.progress.cumulative, lastEvent: run.lastProgress.progress.lastEvent, gogmaDepthMaxima: run.lastProgress.progress.gogmaDepthMaxima,
        gogmaDepths: run.lastProgress.progress.gogmaDepths },
      final: run.final === null ? null : { status: run.final.record.status, searchSummary: run.final.record.searchSummary, firstCandidateKeySha256: run.final.record.firstCandidateKeySha256,
        elapsedMs: run.final.record.elapsedMs, progress: { maxDepth: run.final.progress.maxDepth, cumulative: run.final.progress.cumulative, gogmaDepthMaxima: run.final.progress.gogmaDepthMaxima } },
      semanticParity: run.semanticParity,
      thresholds: analyzed.thresholds,
      top: analyzed.last === null ? null : { thresholdMiB: analyzed.last.thresholdMiB, heapUsedBytes: analyzed.last.heapUsedBytes, ...analyzed.last.summary },
      lastAnalysis: analyzed.last,
    })
    console.log(`${run.runId}: ${run.outcome} t=${analyzed.thresholds.map(t => t.thresholdMiB).join(',')}`)
  }

  // ---- snapshots, one analyzer process each
  async function analyzeSnapshotRun({ id, dir, baselineManifest, nearManifests, expectedSha }) {
    const baseline = baselineManifest === null ? null : await verifyManifest(dir, { ...baselineManifest, sha256: expectedSha?.(baselineManifest) ?? baselineManifest.sha256, present: true })
    const near = []
    for (const s of nearManifests) near.push({ ...(await verifyManifest(dir, { ...s, sha256: expectedSha?.(s) ?? s.sha256, present: true })), writtenAfterSearchStart: s.writtenAfterSearchStart,
      tailLooksComplete: s.tailLooksComplete, lastProgressBeforeWrite: s.lastProgressBeforeWrite ?? null })
    let analyzed = null, analyzer = null, snapshotState
    const usable = near.filter(s => s.verified && s.writtenAfterSearchStart)
    if (near.length === 0) snapshotState = 'not_written'
    else if (usable.length === 0) snapshotState = near.some(s => !s.writtenAfterSearchStart) ? 'written_before_search' : 'partial'
    else if (baseline?.verified !== true) snapshotState = 'partial'
    if (usable.length > 0 && baseline?.verified === true) {
      const outPath = join(analysisDir, `${id}.analysis.json`)
      const exit = await runAnalyzerChild(join(dir, usable[0].file), join(dir, baseline.file), outPath, heapMb)
      if (exit.code === 0 && existsSync(outPath)) {
        analyzed = JSON.parse((await readFile(outPath)).toString('utf8'))
        analyzer = { outcome: 'analyzed', wallMs: exit.wallMs, heapLimitMb: heapMb }
        snapshotState = analyzed.completeness.nodeCountMatchesHeader && analyzed.completeness.edgeCountMatchesHeader ? 'complete' : 'count_mismatch'
      } else {
        const failure = classifyAnalyzerFailure(exit)
        analyzer = { outcome: 'analyzer_failed', failure, exitCode: exit.code, wallMs: exit.wallMs, stderrTail: exit.stderrTail.slice(-2000), heapLimitMb: heapMb }
        snapshotState = failure === 'malformed_or_incomplete_snapshot' ? 'partial' : 'complete_unanalyzed'
      }
      console.log(`${id}: ${analyzer.outcome} ${(exit.wallMs / 1000).toFixed(1)}s ${snapshotState}`)
    }
    return { baseline, near, snapshotState, analyzer, analyzed }
  }
  const snapshotRuns = []
  for (const run of r.snapshotRuns) {
    const dir = join(snapshotsDir, run.diagnosticDir)
    const a = await analyzeSnapshotRun({ id: run.runId, dir, baselineManifest: run.baseline, nearManifests: run.nearLimitSnapshots })
    const searchStatus = run.final?.record.status ?? null
    const childOutcome = run.process.childOutcome
    const outcome = childOutcome === 'timeout' || childOutcome === 'process_failure' ? childOutcome
      : childOutcome === 'out_of_memory' ? (a.snapshotState === 'complete' ? 'snapshot_written_then_oom' : 'snapshot_failed') : searchStatus
    snapshotRuns.push({ runId: run.runId, contextKey: `${run.item.orientationId}#${run.item.workIndex}`, kind: run.item.kind, childOutcome, exitCode: run.process.exitCode,
      wallMs: run.process.wallMs, nodeFlags: run.process.nodeFlags, outcome, snapshotState: a.snapshotState, analyzer: a.analyzer, ready: run.ready,
      baseline: a.baseline === null ? null : { file: a.baseline.file, bytes: a.baseline.bytes, sha256: a.baseline.sha256, verified: a.baseline.verified, writeMs: run.baseline.writeMs,
        memoryAfter: run.baseline.memoryAfter, maxNodeId: a.analyzed?.baseline.maxNodeId ?? null, nodeCount: a.analyzed?.baseline.nodeCount ?? null },
      nearLimitSnapshots: a.near.map(s => ({ file: s.file, bytes: s.bytes, sha256: s.sha256, verified: s.verified, writtenAfterSearchStart: s.writtenAfterSearchStart, tailLooksComplete: s.tailLooksComplete,
        writeStartedAt: s.birthtimeMs, writeFinishedAt: s.mtimeMs, searchStartedAt: run.searchStartedAt,
        lastProgressBeforeWrite: s.lastProgressBeforeWrite === null ? null : { elapsedMs: s.lastProgressBeforeWrite.elapsedMs, memory: s.lastProgressBeforeWrite.memory,
          maxDepth: s.lastProgressBeforeWrite.progress.maxDepth, cumulative: s.lastProgressBeforeWrite.progress.cumulative, lastEvent: s.lastProgressBeforeWrite.progress.lastEvent,
          gogmaDepthMaxima: s.lastProgressBeforeWrite.progress.gogmaDepthMaxima } })),
      completeness: a.analyzed?.completeness ?? null, timings: a.analyzed?.timings ?? null, analyzerMaxRssKiB: a.analyzed?.analyzerMaxRssKiB ?? null, analysis: a.analyzed?.analysis ?? null })
  }

  // ---- old Phase 2-C2.5-C raw artifacts of the same contexts, re-analyzed with the same D2-c rules
  const contextKeys = { primary: r.workload.primary.map(i => `${i.orientationId}#${i.workIndex}`), cleared: r.workload.clearedReferences.map(i => `${i.orientationId}#${i.workIndex}`) }
  let oldReanalysis = { status: 'not_run', reason: 'no --c25c-run given', samplingRuns: [], snapshotRuns: [] }
  if (oldRunPath && oldProfilesDir && oldSnapshotsDir) {
    const rawOldRun = await readFile(oldRunPath)
    if (sha(rawOldRun) !== oldResult.sources.run.sha256) {
      oldReanalysis = { status: 'not_run', reason: 'the old raw run differs from the committed C2.5-C RESULT source', samplingRuns: [], snapshotRuns: [] }
    } else {
      const oldRun = JSON.parse(rawOldRun.toString('utf8'))
      const manifestSha = new Map(oldResult.profileManifest.map(p => [p.file, p.sha256]))
      const oldSampling = []
      for (const run of oldRun.samplingRuns) {
        const key = `${run.item.orientationId}#${run.item.workIndex}`
        if (!(contextKeys.primary.includes(key) || (contextKeys.cleared.includes(key) && run.variant === 'jit_default'))) continue
        const analyzed = await analyzeSamplingRun({ dir: oldProfilesDir, run, profilesManifest: run.profiles, scriptsManifest: run.scripts?.present ? run.scripts : null,
          verifyAgainst: p => manifestSha.has(p.file) ? { sha256: manifestSha.get(p.file) } : null })
        oldSampling.push({ runId: run.runId, variant: run.variant, contextKey: key, outcome: run.outcome, manifestVerified: analyzed.manifest.every(m => m.verified),
          thresholds: analyzed.thresholds, top: analyzed.last === null ? null : { thresholdMiB: analyzed.last.thresholdMiB, heapUsedBytes: analyzed.last.heapUsedBytes, ...analyzed.last.summary },
          lastAnalysis: analyzed.last })
        console.log(`old ${run.runId}: t=${analyzed.thresholds.map(t => t.thresholdMiB).join(',')}`)
      }
      const oldSnapshots = []
      for (const run of oldRun.snapshotRuns) {
        const key = `${run.item.orientationId}#${run.item.workIndex}`
        if (!contextKeys.primary.includes(key)) continue
        const committed = oldResult.snapshotRuns.find(s => s.runId === run.runId)
        const expected = file => (committed?.baseline?.file === file ? committed.baseline.sha256 : committed?.nearLimitSnapshots.find(s => s.file === file)?.sha256) ?? 'missing-from-committed-result'
        const a = await analyzeSnapshotRun({ id: `old-${run.runId}`, dir: join(oldSnapshotsDir, run.diagnosticDir), baselineManifest: run.baseline, nearManifests: run.nearLimitSnapshots,
          expectedSha: m => expected(m.file) })
        oldSnapshots.push({ runId: run.runId, contextKey: key, snapshotState: a.snapshotState, analyzer: a.analyzer, completeness: a.analyzed?.completeness ?? null,
          lastProgressBeforeWrite: run.nearLimitSnapshots[0]?.lastProgressBeforeWrite?.progress ?? null, analysis: a.analyzed?.analysis ?? null })
      }
      oldReanalysis = { status: 'analyzed', reason: null, rawRunSha256: sha(rawOldRun), samplingRuns: oldSampling, snapshotRuns: oldSnapshots }
    }
  }

  // ---- hypotheses (post-D2 primary contexts), and the same rules over the old re-analysis
  const lastOf = (runs, variant, key) => { const run = runs.find(s => s.variant === variant && s.contextKey === key); return run?.lastAnalysis == null ? null : { thresholdMiB: run.lastAnalysis.thresholdMiB, analysis: run.lastAnalysis.analysis } }
  const hypothesisInputs = (runs, snapshots) => contextKeys.primary.map(key => ({ contextKey: key, snapshot: snapshots.find(s => s.contextKey === key)?.analysis ?? null,
    sampling: { jit_default: lastOf(runs, 'jit_default', key), no_inlining: lastOf(runs, 'no_inlining', key) } }))
  const hypotheses = analysis.evaluatePhase2C25D2CHypotheses(hypothesisInputs(samplingRuns, snapshotRuns))
  const oldHypotheses = oldReanalysis.status === 'analyzed' ? analysis.evaluatePhase2C25D2CHypotheses(hypothesisInputs(oldReanalysis.samplingRuns, oldReanalysis.snapshotRuns)) : null
  const recommendation = analysis.selectPhase2C25D2CRecommendation(hypotheses)
  const effectInputs = (runs, snapshots) => contextKeys.primary.map(key => ({ contextKey: key, snapshot: snapshots.find(s => s.contextKey === key)?.analysis ?? null,
    jitDefault: lastOf(runs, 'jit_default', key)?.analysis ?? null, noInlining: lastOf(runs, 'no_inlining', key)?.analysis ?? null }))
  const effect = analysis.evaluatePhase2C25D2CEffect(effectInputs(samplingRuns, snapshotRuns))
  const oldEffect = oldReanalysis.status === 'analyzed' ? analysis.evaluatePhase2C25D2CEffect(effectInputs(oldReanalysis.samplingRuns, oldReanalysis.snapshotRuns)) : null

  // ---- per primary context: top allocation, persistent / in-flight, levels (post-D2 and old side by side)
  const snapshotSummary = a => a === null ? null : {
    newRootBytes: a.newRoot.size, persistentNewBytes: a.persistent.newSize, inFlightNewBytes: a.inFlight.newSize,
    persistentShare: a.newRoot.size === 0 ? null : a.persistent.newSize / a.newRoot.size, inFlightShare: a.newRoot.size === 0 ? null : a.inFlight.newSize / a.newRoot.size,
    persistentRoots: a.persistent.roots,
    splitCuts: a.splitCuts.map(g => ({ ...g, share: a.newRoot.size === 0 ? null : g.cut.newSize / a.newRoot.size })),
    inFlightArrayCuts: a.inFlightArrayCuts.map(g => ({ ...g, share: a.newRoot.size === 0 ? null : g.cut.newSize / a.newRoot.size })),
    arrayCensus: a.arrayCensus.slice(0, 15), signatureCensus: a.signatureCensus.slice(0, 20), stringCensus: a.stringCensus,
    inFlightArrayPaths: a.inFlightArrayPaths,
    topNewSignaturesByShallowSize: a.base.topNewSignaturesByShallowSize.slice(0, 15), retainingPathExamples: a.base.retainingPathExamples,
    retainedIdealCensus: a.base.elementPropertyCensus,
  }
  /**
   * The held-aware Gogma stream structure of one run, from its last progress per-depth counts only: how many streams,
   * the largest one-stream depth (one ensureReserved() depth), the largest same-depth sum over streams, and which streams
   * generated exactly the same per-depth count sequence over their common depths.
   */
  const streamStructure = run => {
    const depths = run?.lastProgress?.gogmaDepths
    if (!depths || depths.length === 0) return null
    const byStream = new Map()
    for (const d of depths) byStream.set(d.streamIndex, [...(byStream.get(d.streamIndex) ?? []), d])
    const sequences = [...byStream.entries()].map(([streamIndex, list]) => ({ streamIndex, generated: list.sort((a, b) => a.depth - b.depth).map(d => d.generatedStates) }))
    const byDepth = new Map()
    for (const d of depths) { const row = byDepth.get(d.depth) ?? { depth: d.depth, streams: 0, generatedStates: 0, frontierStates: 0 }; row.streams++; row.generatedStates += d.generatedStates; row.frontierStates += d.frontierStates; byDepth.set(d.depth, row) }
    const perDepth = [...byDepth.values()].sort((a, b) => a.depth - b.depth)
    const maxSum = perDepth.reduce((best, row) => row.generatedStates > best.generatedStates ? row : best, perDepth[0])
    const groups = new Map()
    for (const s of sequences) {
      const common = Math.min(...sequences.map(t => t.generated.length))
      const key = s.generated.slice(0, common).join(',')
      groups.set(key, [...(groups.get(key) ?? []), s.streamIndex])
    }
    const largestIdentical = [...groups.values()].sort((a, b) => b.length - a.length)[0]
    return { streams: byStream.size, depthEvents: depths.length, cumulativeGenerated: depths.reduce((n, d) => n + d.generatedStates, 0),
      maxGeneratedInOneStreamDepth: run.lastProgress.gogmaDepthMaxima, maxSumOverStreamsAtOneDepth: maxSum,
      streamsWithIdenticalCountsOverCommonDepths: largestIdentical, perDepthSumOverStreams: perDepth, perStreamGenerated: sequences }
  }
  const topOf = run => run?.top == null ? null : { thresholdMiB: run.top.thresholdMiB, topAttributed: run.top.topAttributedRepositoryCallsites.slice(0, 5),
    topCategories: run.top.categories.slice(0, 6).map(c => ({ category: c.category, share: c.share })), topInclusive: run.top.topInclusive.slice(0, 8) }
  const perContext = contextKeys.primary.map(key => {
    const item = r.workload.primary.find(i => `${i.orientationId}#${i.workIndex}` === key)
    const jit = samplingRuns.find(s => s.variant === 'jit_default' && s.contextKey === key)
    const noInl = samplingRuns.find(s => s.variant === 'no_inlining' && s.contextKey === key)
    const snap = snapshotRuns.find(s => s.contextKey === key)
    const oldJit = oldReanalysis.samplingRuns.find(s => s.variant === 'jit_default' && s.contextKey === key)
    const oldNoInl = oldReanalysis.samplingRuns.find(s => s.variant === 'no_inlining' && s.contextKey === key)
    const oldSnap = oldReanalysis.snapshotRuns.find(s => s.contextKey === key)
    const oldFindings = oldResult.findings.perContext.find(c => c.contextKey === key) ?? null
    return {
      contextKey: key, kind: item.kind, d2aDepth: item.d2aDepth,
      postD2: {
        jitDefault: { outcome: jit?.outcome ?? null, thresholdsReached: jit?.thresholds.map(t => t.thresholdMiB) ?? [], thresholdStatus: jit?.thresholdStatus ?? null,
          lastProgress: jit?.lastProgress === null || jit === undefined ? null : { maxDepth: jit.lastProgress.maxDepth, cumulative: jit.lastProgress.cumulative, gogmaDepthMaxima: jit.lastProgress.gogmaDepthMaxima, memory: jit.lastProgress.memory },
          streamStructure: streamStructure(jit), top: topOf(jit) },
        noInliningDiagnostic: { outcome: noInl?.outcome ?? null, thresholdsReached: noInl?.thresholds.map(t => t.thresholdMiB) ?? [], thresholdStatus: noInl?.thresholdStatus ?? null,
          streamStructure: streamStructure(noInl), top: topOf(noInl) },
        snapshot: snap === undefined ? null : { outcome: snap.outcome, snapshotState: snap.snapshotState, lastProgressBeforeWrite: snap.nearLimitSnapshots[0]?.lastProgressBeforeWrite ?? null,
          ...snapshotSummary(snap.analysis) },
      },
      oldC25C: {
        committed: oldFindings === null ? null : { topCallsiteJitDefault: oldFindings.topCallsiteJitDefault, topCallsiteNoInlining: oldFindings.topCallsiteNoInlining,
          snapshotPersistentShare: oldFindings.snapshotPersistentShare, snapshotInFlightShare: oldFindings.snapshotInFlightShare, snapshotRetainedCutShare: oldFindings.snapshotRetainedCutShare,
          snapshotDepthsCutShare: oldFindings.snapshotDepthsCutShare, snapshotStepsCutShare: oldFindings.snapshotStepsCutShare, snapshotHistoryCutShare: oldFindings.snapshotHistoryCutShare,
          snapshotOperationsCutShare: oldFindings.snapshotOperationsCutShare, snapshotKeysCutShare: oldFindings.snapshotKeysCutShare, gogmaMaxDepthAtLastProgress: oldFindings.gogmaMaxDepthAtLastProgress },
        reanalyzedWithD2CRules: { jitDefault: topOf(oldJit), noInliningDiagnostic: topOf(oldNoInl),
          snapshot: oldSnap === undefined ? null : { snapshotState: oldSnap.snapshotState, lastProgressBeforeWrite: oldSnap.lastProgressBeforeWrite === null ? null
            : { maxDepth: oldSnap.lastProgressBeforeWrite.maxDepth, cumulative: oldSnap.lastProgressBeforeWrite.cumulative, lastEvent: oldSnap.lastProgressBeforeWrite.lastEvent }, ...snapshotSummary(oldSnap.analysis) } },
      },
      levels: Object.fromEntries(hypotheses.map(h => [h.id, h.measures.find(m => m.contextKey === key)?.level ?? null])),
      oldLevels: oldHypotheses === null ? null : Object.fromEntries(oldHypotheses.map(h => [h.id, h.measures.find(m => m.contextKey === key)?.level ?? null])),
    }
  })
  const [first, second] = perContext
  const sameCause = first && second ? {
    contexts: [first.contextKey, second.contextKey],
    sameJitDefaultTopAttributedFunction: (first.postD2.jitDefault.top?.topAttributed[0]?.key ?? null) === (second.postD2.jitDefault.top?.topAttributed[0]?.key ?? null),
    sameJitDefaultTopCategory: (first.postD2.jitDefault.top?.topCategories[0]?.category ?? null) === (second.postD2.jitDefault.top?.topCategories[0]?.category ?? null),
    sameLevels: hypotheses.every(h => h.sameLevelInEveryContext),
    levelDifferences: hypotheses.filter(h => !h.sameLevelInEveryContext).map(h => ({ id: h.id, levels: h.measures.map(m => ({ contextKey: m.contextKey, level: m.level })) })),
  } : null

  // ---- cleared reference and controls
  const clearedReferences = contextKeys.cleared.map(key => {
    const run = samplingRuns.find(s => s.contextKey === key && s.variant === 'jit_default')
    const oldCommitted = oldResult.samplingRuns.find(s => s.variant === 'jit_default' && s.contextKey === key)
    const oldRe = oldReanalysis.samplingRuns.find(s => s.variant === 'jit_default' && s.contextKey === key)
    return { contextKey: key, role: 'cleared_reference', usedAsDirectEvidence: false,
      postD2: run === undefined ? null : { outcome: run.outcome, finalStatus: run.final?.status ?? null, maxDepth: run.final?.progress.maxDepth ?? run.lastProgress?.maxDepth ?? null,
        gogmaDepthMaxima: run.final?.progress.gogmaDepthMaxima ?? null, thresholdsReached: run.thresholds.map(t => t.thresholdMiB), thresholdStatus: run.thresholdStatus, semanticParity: run.semanticParity, top: topOf(run) },
      oldC25C: { committed: oldCommitted === undefined ? null : { outcome: oldCommitted.outcome, thresholdsReached: oldCommitted.thresholdsReached, maxDepth: oldCommitted.lastProgress?.progress?.maxDepth ?? null,
        topAttributedRepositoryCallsites: oldCommitted.top?.attributedRepositoryCallsites.slice(0, 5).map(s => ({ key: s.key, share: oldCommitted.top.totalSampledBytes === 0 ? 0 : s.sampledSelfBytes / oldCommitted.top.totalSampledBytes })) ?? null },
        reanalyzedWithD2CRules: topOf(oldRe) } }
  })
  const semanticRuns = samplingRuns.filter(s => s.semanticParity !== null)
  const controls = r.workload.controls.map(item => {
    const key = `${item.orientationId}#${item.workIndex}`
    return { contextKey: key, role: item.role, expected: item.expected, runs: semanticRuns.filter(s => s.contextKey === key).map(s => ({ variant: s.variant, outcome: s.outcome, ...s.semanticParity })) }
  })
  const contamination = { runs: semanticRuns.length, contaminated: semanticRuns.filter(s => s.semanticParity.contaminated).length,
    rows: semanticRuns.map(s => ({ runId: s.runId, variant: s.variant, role: s.role, ...s.semanticParity })) }

  const rawArtifactVerification = {
    rule: 'every raw profile / snapshot is re-hashed and compared with the SHA-256 the formal run recorded; old C2.5-C artifacts are compared with the committed C2.5-C RESULT manifest',
    rawRunSha256: sha(rawRun),
    profiles: { count: profileManifest.length, verified: profileManifest.filter(p => p.verified).length },
    snapshots: { count: snapshotRuns.reduce((n, s) => n + s.nearLimitSnapshots.length + (s.baseline === null ? 0 : 1), 0),
      verified: snapshotRuns.reduce((n, s) => n + s.nearLimitSnapshots.filter(x => x.verified).length + (s.baseline?.verified ? 1 : 0), 0) },
    oldC25C: oldReanalysis.status !== 'analyzed' ? null : {
      rawRunSha256: oldReanalysis.rawRunSha256,
      profiles: { count: oldReanalysis.samplingRuns.reduce((n, s) => n + s.thresholds.length, 0), runsFullyVerified: oldReanalysis.samplingRuns.filter(s => s.manifestVerified).length, runs: oldReanalysis.samplingRuns.length },
      snapshots: oldReanalysis.snapshotRuns.map(s => ({ runId: s.runId, snapshotState: s.snapshotState })),
    },
  }

  const evidence = {
    phase: 'Issue #154 Phase 2-C2.5-D2-c: post-D2 heap profiling of the shallow Search-only OOM (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: { file: basename(runPath), bytes: rawRun.length, sha256: sha(rawRun) }, d2a: { file: basename(d2aPath), sha256: sha(rawD2A) }, c25c: { file: basename(oldResultPath), sha256: sha(rawOldResult) } },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: [...changed, ...untracked], calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: [...POST_HOC, '*.test.ts'], formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode, rulesSha256,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      d2aResultFileName: r.environment.d2aResultFileName, d2aResultSha256: r.environment.d2aResultSha256, d2aMeasuredHead: r.environment.d2aMeasuredHead,
      d2bResultFileName: r.environment.d2bResultFileName, d2bResultSha256: r.environment.d2bResultSha256,
      c25cResultFileName: r.environment.c25cResultFileName, c25cResultSha256: r.environment.c25cResultSha256,
      c25aEvidenceFileName: r.environment.c25aEvidenceFileName, c25aEvidenceSha256: r.environment.c25aEvidenceSha256,
      measuredAt: r.measuredAt, runWallMs: r.wallMs, rawArtifactVerification,
      environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
        osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    },
    conditions: {
      concurrency: r.environment.concurrency, freshChildPerRun: true, samplingAndSnapshotInSeparateChildren: true, nodeYield: r.environment.nodeYield,
      searchExtent: r.environment.searchExtent, candidateStopBound: r.environment.candidateStopBound, calculationContext: r.environment.calculationContext,
      researchMaxPlanSteps: r.environment.researchMaxPlanSteps, sampling: r.environment.sampling,
      snapshot: { ...r.environment.snapshot, analyzerHeapLimitMb: heapMb, analyzerConcurrency: 1 },
      progressHeartbeatMs: r.environment.progressHeartbeatMs, runBudgetMs: r.environment.runBudgetMs,
      instrumentation: 'held-aware depth hooks reduced to counters (createPhase2C25D2CProgressObserver: C2.5-C counters + per-depth generated / frontier counts); no counting Engine',
      productionCodeChanged: false,
    },
    samplingOptionProbe: r.probe,
    workload: { rule: r.workload.rule, digest: r.workload.digest,
      primary: r.workload.primary.map(({ expected, ...rest }) => ({ ...rest, d2aStatus: expected.status })),
      clearedReferences: r.workload.clearedReferences.map(({ expected, ...rest }) => ({ ...rest, d2aStatus: expected.status, d2aSearchSummary: expected.searchSummary })),
      controls: r.workload.controls.map(({ expected, ...rest }) => ({ ...rest, d2aStatus: expected.status, d2aSearchSummary: expected.searchSummary, d2aFirstCandidateKeySha256: expected.firstCandidateKeySha256 })),
      unselected: r.workload.unselected, c25cControlRuleCrossCheck: r.c25cWorkload },
    contextParity: { contexts: r.parity.length, matching: r.parity.filter(p => p.matches).length, rows: r.parity },
    // Per-depth progress lists are kept for the primary runs only (the stream structure above is derived from them).
    samplingRuns: samplingRuns.map(({ lastAnalysis: _last, ...rest }) => rest.role === 'primary_oom' || rest.lastProgress === null ? rest
      : { ...rest, lastProgress: { ...rest.lastProgress, gogmaDepths: undefined, gogmaDepthsOmitted: rest.lastProgress.gogmaDepths.length } }),
    profileManifest,
    snapshotRuns: snapshotRuns.map(({ analysis: a, ...rest }) => ({ ...rest, summary: snapshotSummary(a) })),
    rules: { sha256: rulesSha256, verdictRule: analysis.PHASE2C25D2C_VERDICT_RULE, effectRule: analysis.PHASE2C25D2C_EFFECT_RULE, recommendationRule: analysis.PHASE2C25D2C_RECOMMENDATION_RULE,
      categoryRules: analysis.PHASE2C25D2C_CATEGORY_RULES, holderSignatures: analysis.PHASE2C25D2C_HOLDER_SIGNATURES, persistentRootPrefixes: analysis.PHASE2C25D2C_PERSISTENT_ROOT_PREFIXES },
    hypothesisScope: 'Formal: the snapshot measure (512 MB near-limit snapshot, JIT-independent structure) and the jit_default (Production-like JIT) sampling share. The no_inlining share is a diagnostic allocation attribution, reported beside, never a verdict input.',
    hypotheses,
    oldC25CHypothesesUnderD2CRules: oldHypotheses,
    d2aEffectValidation: { rule: analysis.PHASE2C25D2C_EFFECT_RULE.text, postD2: effect, oldC25CUnderSameRule: oldEffect },
    perContext,
    shallowContextsComparison: sameCause,
    clearedReferences,
    controls,
    profilerContamination: contamination,
    oldC25CReanalysis: { status: oldReanalysis.status, reason: oldReanalysis.reason,
      samplingRuns: oldReanalysis.samplingRuns.map(({ lastAnalysis: _l, ...rest }) => rest),
      snapshotRuns: oldReanalysis.snapshotRuns.map(({ analysis: a, ...rest }) => ({ ...rest, summary: snapshotSummary(a) })) },
    mechanicalRecommendation: recommendation,
    interpretation: interpretation.PHASE2C25D2C_INTERPRETATION,
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, hypotheses: hypotheses.map(h => `${h.id}:${h.level} [${h.measures.map(m => `${m.contextKey} snap ${pct(m.snapshotShare)} samp ${pct(m.samplingShareJitDefault)} ${m.level}`).join(' | ')}]`),
    oldHypotheses: oldHypotheses?.map(h => `${h.id}:${h.level}`) ?? null, effect: effect.map(e => `${e.id}:${e.level}`), recommendation: recommendation.primary,
    contamination: contamination.contaminated, snapshots: snapshotRuns.map(s => `${s.runId}: ${s.outcome} ${s.snapshotState}`) }, null, 2))
  void round
})
