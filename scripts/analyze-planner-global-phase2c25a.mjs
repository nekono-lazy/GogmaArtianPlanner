// Issue #154 Phase 2-C2.5-A: post-hoc analysis of one raw run of run-planner-global-phase2c25a.mjs.
// Reads the raw run and the Phase 2-C2 evidence (explicit --c2, post-hoc comparison only) and writes the committed
// evidence JSON. Runs no Planner and no Search. Raw stable keys are hashed; raw progress stays in the .local files.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c2Path = option('--c2'), outputPath = option('--output')
if (!runPath || !c2Path || !outputPath) throw new Error('Usage: node scripts/analyze-planner-global-phase2c25a.mjs --run <raw.json.local> --c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output <new.json> [--allow-nonformal]')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c2 = await load(c2Path)
const r = run.json
if (r.status !== 'completed') throw new Error(`The raw run did not complete its Search runs (status ${r.status}).`)
if (r.environment.c2EvidenceSha256 !== c2.source.sha256) throw new Error('The raw run selected its workload from another Phase 2-C2 evidence file.')
const formal = r.environment.uncommittedBenchmarkCode === false && r.environment.smoke === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The raw run is not formal (uncommitted code or smoke options).')

// The calculation code (modules, runner and everything they load) must be the measured HEAD; only post-hoc analysis
// code, tests and documents may change after the measurement.
const measuredHead = r.environment.repositoryHead
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts').split(/\r?\n/).filter(Boolean)
const postHocOnly = path => path === 'src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts' || path === 'scripts/analyze-planner-global-phase2c25a.mjs' || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

const ranges = values => {
  const out = []
  for (const value of [...new Set(values)].sort((a, b) => a - b)) { const last = out.at(-1); if (last && value === last[1] + 1) last[1] = value; else out.push([value, value]) }
  return out
}
const reservationSummary = reservation => reservation === null ? null : {
  normal: reservation.normal.map(n => ({ counterId: n.counterId, held: ranges(n.held), blocked: ranges(n.blocked) })),
  skill: { held: ranges(reservation.skill.held), blocked: ranges(reservation.skill.blocked) },
  gogma: { held: ranges(reservation.gogma.held), blocked: ranges(reservation.gogma.blocked) },
  exclusiveOwnedWeaponIds: reservation.exclusiveOwnedWeaponIds,
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts')
  const view = analysis.parsePhase2C25AC2Evidence(c2.json)
  const result = analysis.analyzePhase2C25ARun(r, view)
  const selectedIds = new Set(r.selection.selectedRun.map(item => item.orientationId))
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.5-A: kernel OOM localization to Planner Alternative Search (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c2: c2.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c2EvidenceFileName: r.environment.c2EvidenceFileName, c2EvidenceSha256: r.environment.c2EvidenceSha256, c2MeasuredHead: r.environment.c2MeasuredHead,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
      environment: { runtime: r.environment.runtime, node: r.environment.node, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
        cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    },
    conditions: {
      childHeapLimitMb: r.environment.childHeapLimitMb, concurrency: r.environment.concurrency, freshChildPerSearchRun: true, modes: ['minimal', 'instrumented'],
      nodeYield: r.environment.nodeYield, searchExtent: r.environment.searchExtent, candidateStopBound: r.environment.candidateStopBound,
      snapshotPolicy: r.environment.snapshotPolicy, runBudgetMs: r.environment.runBudgetMs, calculationContext: r.environment.calculationContext,
      researchMaxPlanSteps: r.environment.researchMaxPlanSteps, priorFixedBuildListEntryIds: [], priorExcludedRoutes: [],
    },
    selection: { rule: r.selection.rule, selected: r.selection.selected, unavailable: r.selection.unavailable },
    baseline: r.baseline,
    parity: {
      orientation: r.orientationParity,
      preSearchContext: {
        orientations: r.contextParity.length, orientationsMatching: r.contextParity.filter(row => row.matches).length,
        contexts: r.contextParity.flatMap(row => row.rows).length, contextsMatching: r.contextParity.flatMap(row => row.rows).filter(row => row.matches).length,
        rows: r.contextParity.map(row => ({ orientationId: row.orientationId, matches: row.matches, countMatches: row.countMatches, rows: row.rows })),
      },
    },
    preSearchContexts: Object.entries(r.contexts).filter(([id]) => selectedIds.has(id)).map(([orientationId, list]) => ({ orientationId,
      contexts: list.map(context => ({ workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, status: context.status,
        invalidatedBuildListEntryId: context.invalidatedBuildListEntryId, invalidatedRouteKeySha256: sha(context.invalidatedRouteKey),
        fixedRouteBuildListEntryIds: context.fixedRouteBuildListEntryIds, reservation: reservationSummary(context.reservation),
        excludedRouteKeySha256s: context.excludedRouteKeys.map(sha), extent: context.extent, originDigest: context.originDigest, contextDigest: context.contextDigest })) })),
    blockedContexts: r.blockedContexts,
    ...result,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, timedOut: p.timedOut, wallMs: p.wallMs, startedAt: p.startedAt })),
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, totals: result.totals, orientations: result.orientations.map(o => `${o.orientationId}:${o.classification}`) }, null, 2))
} finally {
  await server.close()
}
