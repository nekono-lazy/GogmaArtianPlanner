// Issue #154 Phase 0 missing-Target diagnosis (Research only). Explicit external Export input; never imports into the app.
//   --mode run    --strategy control|normal-2x-fallback : Phase 0 sequential projection (+ the Phase 1-E generic Normal fallback),
//                 then a resource map for every bounded no-match and the final Conflict / rejection detail.
//   --mode verify --generated <run output .entries.local.json> : fresh ordinary Planner over the original 43 Targets.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cpus, totalmem } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const mode = option('--mode'), exportPath = option('--export'), outputPath = option('--output')
const strategy = option('--strategy') ?? 'control'
const generatedPath = option('--generated')
const maxPlanSteps = Number(option('--max-plan-steps') ?? 20000)
const attemptBudgetMs = Number(option('--attempt-budget-ms') ?? 900000)
const fallbackBudgetMs = Number(option('--fallback-budget-ms') ?? 180000)
if (!['run', 'verify'].includes(mode) || !exportPath || !outputPath) throw new Error('Usage: --mode run|verify --export <external.json> --output <new.json> [--strategy control|normal-2x-fallback] [--generated <entries.local.json>]')
if (!['control', 'normal-2x-fallback'].includes(strategy)) throw new Error('Invalid strategy.')
if (mode === 'verify' && !generatedPath) throw new Error('--mode verify needs --generated.')
if (!Number.isSafeInteger(maxPlanSteps) || maxPlanSteps < 1 || !Number.isFinite(attemptBudgetMs) || attemptBudgetMs <= 0 || !Number.isFinite(fallbackBudgetMs) || fallbackBudgetMs <= 0) throw new Error('Invalid bounds.')
const entriesPath = `${outputPath}.entries.local.json`
const outputs = mode === 'run' ? [outputPath, entriesPath] : [outputPath]
const inputs = [exportPath, generatedPath].filter(Boolean)
if (outputs.some(p => inputs.some(i => resolve(i).toLowerCase() === resolve(p).toLowerCase()))) throw new Error('Outputs must differ from inputs.')
for (const path of outputs) if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(path)}`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const probe = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationExtentProbe.ts')
  const missing = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase0Missing.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const raw = await readFile(exportPath, 'utf8')
  const input = research.globalResearchInputFromExport(JSON.parse(raw), maxPlanSteps)
  const engine = new ProductionRngEngine()
  const dependencies = research.globalResearchDependencies(engine)
  const environment = { runtime: 'Node (not Browser Worker)', node: process.version, platform: process.platform, arch: process.arch,
    heapSizeLimitBytes: getHeapStatistics().heap_size_limit, cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    exportSha256: createHash('sha256').update(raw).digest('hex'), rngEngineVersion: engine.version, maxPlanSteps, extent: research.GLOBAL_RESEARCH_EXTENT }
  const memory = () => ({ maxRssKiB: process.resourceUsage().maxRSS, scope: 'whole Node process, includes Vite loader and Export parsing' })
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  if (mode === 'verify') {
    const generated = JSON.parse(await readFile(generatedPath, 'utf8'))
    if (generated.exportSha256 !== environment.exportSha256) throw new Error('Generated Entries come from another Export.')
    const started = performance.now()
    const verification = await missing.verifyGlobalResearchFreshPlan(input, generated.entries, dependencies)
    const record = { environment, mode, generatedSource: { path: resolve(generatedPath), strategy: generated.strategy, entryCount: generated.entries.length, entriesSha256: sha(generated.entries) },
      verification, elapsedMs: performance.now() - started, memory: memory() }
    await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output: resolve(outputPath), success: verification.success, completed: `${verification.completedTargetCount}/${verification.planningTargetCount}`,
      conflicts: verification.conflicts.length, rejected: verification.rejected.length, steps: verification.steps, termination: verification.terminationStatus, replay: verification.plannerTraceReplay }, null, 2))
    if (!verification.success) process.exitCode = 2
  } else {
    const searchStates = [], noMatches = []
    const counterOf = search => ({ targetId: search.targetWeaponId,
      normal: Object.fromEntries(search.normalCounters.filter(c => c.isConfirmed).map(c => [c.weaponTypeId, c.counter])),
      gogma: search.rngState.gogmaCounter.value, skill: search.rngState.skillCounter.value })
    let lastStage = ''
    const result = await research.runGlobalPlannerResearch(input, dependencies, {
      timeBudgetMs: attemptBudgetMs,
      yieldControl: () => new Promise(r => setTimeout(r, 0)),
      extentFallback: strategy === 'normal-2x-fallback' ? probe.createSingleAxisExtentFallback('normal', fallbackBudgetMs, 3) : undefined,
      onSearchInput: search => searchStates.push(counterOf(search)),
      onBoundedNoMatch: capture => noMatches.push(capture),
      onProgress: report => {
        const stage = `${report.stage}: ${report.searches.length} searches / ${report.generatedReplacementCount} replacements / ${report.status}`
        if (stage !== lastStage) { console.error(stage); lastStage = stage }
      },
    })
    const targetOf = new Map(input.buildListEntries.map(e => [e.id, e.targetWeaponId]))
    for (const entry of result.generatedEntries) targetOf.set(entry.id, entry.targetWeaponId)
    const final = result.finalResult
    const resourceMaps = noMatches.map(capture => {
      const normalFrom = 0, gogmaTo = (capture.searchInput.rngState.gogmaCounter.value ?? 0) + 1000, skillTo = (capture.searchInput.rngState.skillCounter.value ?? 0) + 3000
      const started = performance.now()
      const map = missing.mapGlobalResearchTargetResources(capture.searchInput, engine, { normal: { from: normalFrom, to: 1100 }, gogma: { from: 0, to: gogmaTo }, skill: { from: 0, to: skillTo } })
      return { searchIndex: capture.searchIndex, measurement: capture.measurement, map, elapsedMs: performance.now() - started }
    })
    const record = { environment, mode, strategy, attemptBudgetMs, fallbackBudgetMs, report: result.report,
      searchStates, resourceMaps,
      finalDetail: final ? {
        termination: final.termination, warnings: final.warnings,
        conflicts: final.conflicts.map(c => ({ id: c.id, kind: c.kind, reason: c.reason, entryIds: c.buildListEntryIds, targetIds: c.buildListEntryIds.map(id => targetOf.get(id) ?? id),
          selectedEntryId: c.selectedBuildListEntryId, recommendedEntryId: c.recommendedBuildListEntryId })),
        rejected: final.plan?.rejectedBuildListEntries.map(r => ({ entryId: r.buildListEntryId, targetId: targetOf.get(r.buildListEntryId) ?? null, reason: r.reason })) ?? [],
        selectedEntryIds: final.plan?.selectedBuildListEntryIds ?? [],
        planSha256: sha(final.plan ?? null), finalResultSha256: sha(final),
      } : null,
      generatedEntries: result.generatedEntries.map(e => ({ id: e.id, targetId: e.targetWeaponId, routeKind: e.candidateSnapshot.route.kind, estimatedOperationCount: e.candidateSnapshot.estimatedOperationCount,
        advances: { normal: e.candidateSnapshot.estimatedNormalAdvance, gogma: e.candidateSnapshot.estimatedGogmaAdvance, skill: e.candidateSnapshot.estimatedSkillAdvance }, entrySha256: sha(e) })),
      memory: memory() }
    await writeFile(entriesPath, JSON.stringify({ exportSha256: environment.exportSha256, strategy, entries: result.generatedEntries }) + '\n', { flag: 'wx' })
    await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output: resolve(outputPath), status: result.report.status, final: result.report.final && { completed: result.report.final.completedTargetCount,
      conflicts: result.report.final.conflicts, rejected: result.report.final.rejected, steps: result.report.final.steps, replay: result.report.final.traceReplay }, totalElapsedMs: result.report.totalElapsedMs }, null, 2))
    if (result.report.status === 'error') process.exitCode = 1
  }
} finally {
  await server.close()
}
