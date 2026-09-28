// Issue #154 Phase 2-C2.5-B: post-hoc analysis of one real Chrome measurement run.
//
// Reads the run directory the external CDP driver wrote (the page's verbatim exportJson() of every page session and the
// driver's external evidence) and the Phase 2-C2.5-A evidence (explicit --evidence; post-hoc Node comparison only), and
// writes the three committed files. Runs no Planner and no Search. The page exports are committed as they are (wrapped
// in one list); the external evidence is committed as the driver wrote it. A re-analysis of an already committed run
// never rewrites those two raw files: when they exist, the analyzer only checks that the same run reproduces them byte
// for byte (and fails otherwise), and records that check in the provenance.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runDir = option('--run-dir'), evidencePath = option('--evidence'), outputPath = option('--output')
const browserOutput = option('--browser-output'), externalOutput = option('--external-output')
if (!runDir || !evidencePath || !outputPath || !browserOutput || !externalOutput) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c25b.mjs --run-dir <driver out dir> --evidence docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json '
    + '--output <results.json> --browser-output <browser results.json> --external-output <external memory.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { raw, json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }

const evidence = await load(evidencePath)
const external = await load(join(runDir, 'external.json'))
const pageFiles = (await readdir(runDir)).filter(name => /^page-session-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
const pages = await Promise.all(pageFiles.map(name => load(join(runDir, name))))
if (pages.length === 0) throw new Error('The run directory holds no page export.')
if (external.json.error) throw new Error(`The driver stopped with an error: ${external.json.error}`)
if (!external.json.completedAt) throw new Error('The driver did not complete its series.')

// Formal: every page session ran the same clean committed build, prepared with full context parity, on the same inputs.
const builds = new Set(pages.map(page => JSON.stringify(page.json.environment.benchmarkBuild)))
if (builds.size !== 1) throw new Error('Page sessions ran different benchmark builds.')
const build = pages[0].json.environment.benchmarkBuild
const formal = build !== null && build.uncommittedBenchmarkCode === false && pages.every(page => page.json.preparation?.status === 'ok' && page.json.preparation.parity?.matches === true)
  && external.json.driver.only === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The run is not formal (uncommitted benchmark code, a failed parity or a smoke subset).')
for (const page of pages) {
  if (page.json.evidenceInfo?.sha256 !== evidence.source.sha256) throw new Error('A page session selected its workload from another Phase 2-C2.5-A evidence file.')
}
const measuredHead = build.commit
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts', 'benchmark.html')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => path === 'src/benchmarks/plannerGlobalPhase2C25BAnalysis.ts' || path === 'scripts/analyze-planner-global-phase2c25b.mjs' || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Benchmark code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const evidenceModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25BEvidence.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25BAnalysis.ts')
  const view = evidenceModule.parsePhase2C25BEvidence(evidence.json)
  const exportSha256 = pages[0].json.exportInfo.sha256
  if (pages.some(page => page.json.exportInfo.sha256 !== exportSha256) || exportSha256 !== view.exportSha256) throw new Error('The Export differs between sessions or from the evidence.')
  const result = analysis.analyzePhase2C25B(pages.map(page => page.json), external.json, view)
  const env = pages[0].json.environment
  const t = result.totals, v = result.verdict
  const workerRealmJsHeapSizeLimit = pages.flatMap(page => page.json.records).find(record => record.workerEnvironment?.performanceMemory)?.workerEnvironment.performanceMemory.jsHeapSizeLimit ?? null
  const statements = {
    formal: [
      `Context parity: every page session re-derived the ${t.contexts} selected contexts from the original Export and matched the Phase 2-C2.5-A evidence field by field (digests included) before any Search.`,
      `Completed controls: ${t.controlsWithSemanticParity} / ${t.controls} contexts ended normally in both modes with equal Browser semantics, equal to Node in status, Search summary and first Candidate key.`,
      `Instrumentation contamination: ${t.instrumentationContamination}.`,
      `OOM representatives (formal rule): ${v.representatives.map(r => `${r.orientationId}#${r.workIndex} ${r.browserClassification}`).join(', ')}; verdict ${v.formal}.`,
      `Auxiliary: in ${v.auxiliary.lostDuringSearchBeforeFirstCandidate} / ${v.auxiliary.representativeRuns} representative runs the renderer was lost while the Search Worker ran, after the Search started and before any first Candidate notice; ${v.auxiliary.explicitV8OomCrashKey} of them carry a V8 OOM crash key in that run's renderer crash dump.`,
    ],
    notFormal: [
      ...(t.nativeWorkerFailures === 0 && v.auxiliary.representativeRuns > 0 && v.auxiliary.lostDuringSearchBeforeFirstCandidate === v.auxiliary.representativeRuns
        ? ['That this Chrome delivers a native Worker error for the representatives: none of the recorded runs saw one; each representative run ended with the renderer process lost.']
        : []),
      'That the Node 8 GB OOM and the Browser renderer loss happen at the same Search state: only the sampled heap and the last received progress are compared, and the heap limits are not compared directly.',
      `The Dedicated Worker's own heap limit. ${analysis.phase2c25bWorkerHeapLimitStatement({
        representativeSampledMaxBytes: result.runs.filter(run => v.representatives.some(r => r.orientationId === run.orientationId && r.workIndex === run.workIndex))
          .map(run => run.cdp.maxUsedBytes).filter(bytes => bytes !== null),
        pageRealmJsHeapSizeLimit: env.mainRealmPerformanceMemory?.jsHeapSizeLimit ?? null,
        workerRealmJsHeapSizeLimit,
      })}`,
      'The heap-holding objects (no heap snapshot or allocation profile), the other 40 Phase 2-C2 OOM orientations, other browsers or mobile devices.',
    ],
  }
  // The raw evidence: written for a new run, only verified byte for byte when it already exists (never rewritten).
  const rawEvidence = {}
  const browserContent = Buffer.from(JSON.stringify({ phase: 'Issue #154 Phase 2-C2.5-B: the page exportJson() of every page session, verbatim',
    sessions: pages.map((page, index) => ({ session: index + 1, source: page.source, export: page.json })) }, null, 1) + '\n')
  for (const [key, path, content] of [['browserResults', browserOutput, browserContent], ['externalMemory', externalOutput, external.raw]]) {
    if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
      const existing = await readFile(path)
      if (!existing.equals(content)) throw new Error(`${path} exists and differs from what this run reproduces; raw evidence is never rewritten.`)
      rawEvidence[key] = { file: basename(path), sha256: sha(existing), bytes: existing.length, action: 'verified_unchanged' }
    } else {
      await writeFile(path, content, { flag: 'wx' })
      rawEvidence[key] = { file: basename(path), sha256: sha(content), bytes: content.length, action: 'written' }
    }
  }
  const results = {
    phase: 'Issue #154 Phase 2-C2.5-B: Browser Worker reproduction of the Search-only failure (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { pages: pages.map(page => page.source), external: external.source, evidence: evidence.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, formal,
      benchmarkCodeSha256: build.benchmarkCodeSha256, uncommittedBenchmarkCode: build.uncommittedBenchmarkCode,
      exportFileName: pages[0].json.exportInfo.fileName, exportSha256, exportBytes: pages[0].json.exportInfo.byteSize,
      evidenceFileName: pages[0].json.evidenceInfo.fileName, evidenceSha256: evidence.source.sha256, c25aMeasuredHead: view.measuredHead,
      driverSha256: external.json.driver.sha256, measuredAt: external.json.driver.startedAt, pageSessions: pages.length,
      rawEvidence,
    },
    environment: {
      chrome: external.json.driver.chromeVersion, chromeFlags: external.json.driver.chromeFlags, userAgent: env.userAgent, userAgentData: env.userAgentData,
      hardwareConcurrency: env.hardwareConcurrency, deviceMemory: env.deviceMemory, crossOriginIsolated: env.crossOriginIsolated, isSecureContext: env.isSecureContext,
      visibilityAtSessionStart: pages.map(page => page.json.environment.visibilityState), mainRealmPerformanceMemory: env.mainRealmPerformanceMemory,
      workerPerformanceMemory: pages[0].json.records[0]?.workerEnvironment?.performanceMemory ?? null, machine: external.json.machine,
      heapLimits: {
        pageRealmJsHeapSizeLimit: env.mainRealmPerformanceMemory?.jsHeapSizeLimit ?? null,
        workerRealmJsHeapSizeLimit,
        workerHeapLimitMeasured: workerRealmJsHeapSizeLimit !== null,
        note: 'The page realm limit is another realm\'s value, given for reference only. The Dedicated Worker used heap is the external CDP sample (runs[].cdp). Neither is compared with the Node 8 GB limit.',
      },
      rngEngineVersion: env.rngEngineVersion, calculationAppSchemaVersion: env.calculationAppSchemaVersion,
    },
    conditions: {
      searchExtent: env.searchExtent, candidateStopBound: env.candidateStopBound, snapshotPolicy: env.snapshotPolicy, cdpSampleIntervalMs: external.json.driver.intervalMs,
      runBudgetMs: env.runBudgetMs, driverRunBudgetMs: external.json.driver.runBudgetMs, researchMaxPlanSteps: env.researchMaxPlanSteps, yield: env.yield,
      workerPolicy: env.workerPolicy, modes: ['minimal', 'instrumented'], repeatPolicy: 'a context whose pair had a page / browser crash, a native Worker failure, a mode disagreement or a CDP attach failure is run once more; both attempts are kept',
      nodeChildHeapLimitMb: view.childHeapLimitMb,
    },
    parity: pages.map((page, index) => ({ session: index + 1, status: page.json.preparation.status, matches: page.json.preparation.parity.matches,
      rows: page.json.preparation.parity.rows.length, matchingRows: page.json.preparation.parity.rows.filter(row => row.matches).length,
      baselineSummary: page.json.preparation.parity.baselineSummary, contextsWorker: page.json.preparation.contextsWorker })),
    workload: pages[0].json.workload,
    repeatDecisions: external.json.repeatDecisions ?? [],
    ...result,
    statements,
  }
  await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, totals: result.totals, verdict: result.verdict }, null, 2))
} finally {
  await server.close()
}
