// Issue #154 Phase 2-A.5 (Research only). Explicit external Export input; never imports into the app or
// opens IndexedDB. Verifies the 1,657 oracle (Stage A RNG, Stage B Production Search materialization,
// Stage C Production Planner + Trace Replay) and audits the physical operation lower bound.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const inputPath = option('--export'), outputPath = option('--output')
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/run-planner-global-oracle-1657.mjs --export <external.json> --output <new-result.json> [--max-plan-steps 5000]')
if (resolve(inputPath) === resolve(outputPath)) throw new Error('Output must not overwrite the input Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
const maxPlanSteps = Number(option('--max-plan-steps') ?? 5000)
if (!Number.isSafeInteger(maxPlanSteps) || maxPlanSteps < 1) throw new Error('Invalid --max-plan-steps.')

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const git = (...values) => execFileSync('git', values, { encoding: 'utf8' }).trim()
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const load = path => server.ssrLoadModule(path)
  const research = await load('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const oracle = await load('/src/benchmarks/plannerGlobalOracle1657.ts')
  const manifest = await load('/src/benchmarks/plannerGlobalOracle1657Manifest.ts')
  const lowerBound = await load('/src/benchmarks/plannerGlobalLowerBound.ts')
  const { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } = await load('/src/domain/rng/production/productionRngEngine.ts')
  const { loadMasterData } = await load('/src/domain/master/loadMasterData.ts')
  const raw = await readFile(inputPath)
  const exportSha256 = createHash('sha256').update(raw).digest('hex')
  if (exportSha256 !== manifest.ORACLE_1657_EXPORT_SHA256) throw new Error(`Export SHA-256 ${exportSha256} is not the oracle Export; refusing to treat it as the same acceptance case.`)
  const input = research.globalResearchInputFromExport(JSON.parse(raw.toString('utf8')), maxPlanSteps)
  const engine = new ProductionRngEngine()
  const routes = manifest.ORACLE_1657_ROUTES
  const environment = { runtime: 'Node (Vite SSR loader, not Browser Worker)', node: process.version, platform: process.platform, arch: process.arch, osRelease: release(),
    cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), heapSizeLimitBytes: getHeapStatistics().heap_size_limit,
    repositoryHead: git('rev-parse', 'HEAD'), uncommittedResearchCode: git('status', '--porcelain', '--', 'src', 'scripts') !== '',
    exportFileName: manifest.ORACLE_1657_EXPORT_FILE_NAME, exportBytes: raw.length, exportSha256,
    rngEngineVersion: engine.version, productionRngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, calculationContext: input.calculationContext, researchMaxPlanSteps: maxPlanSteps }

  const t0 = performance.now()
  const rng = oracle.verifyOracleRng(input, engine, routes)
  const t1 = performance.now()
  const materialization = await oracle.materializeOracleRoutes(input, engine, routes, rng)
  const t2 = performance.now()
  const planner = await oracle.runOraclePlanner(input, research.globalResearchDependencies(new ProductionRngEngine()), materialization.entries, maxPlanSteps)
  const t3 = performance.now()
  const budget = manifest.ORACLE_1657_PHYSICAL_OPERATIONS + 1
  // Skill states for the cross-satisfaction audit: every Master Series / Group Skill ID (disabled ones included).
  const master = loadMasterData()
  if (!master.ok) throw new Error('Master Data failed validation.')
  const skillStates = { seriesSkillIds: master.data.seriesSkills.map(skill => skill.id), groupSkillIds: master.data.groupSkills.map(skill => skill.id) }
  const problem = lowerBound.collectLowerBoundProblem(input, new ProductionRngEngine(), budget, skillStates)
  const relaxation = lowerBound.solveLowerBoundRelaxation(problem, { recordAbove: 30 })
  const singleStream = lowerBound.singleStreamLowerBounds(problem)
  const t4 = performance.now()

  const { plan, ...plannerSummary } = planner
  const streams = oracle.oracleStreamTotals(rng)
  const verdict = oracle.classifyOracleVerdict({ rngPassed: rng.passed, materializationPassed: materialization.passed, planner, routeCount: routes.length,
    oraclePhysicalOperations: rng.physicalOperations, lowerBoundTotal: lowerBound.provenLowerBoundTotal(relaxation) })
  const targetsById = new Map(input.targetWeapons.map(target => [target.id, target]))
  const routeSummary = rng.targets.map(target => {
    const m = materialization.targets.find(value => value.targetWeaponId === target.targetWeaponId)
    const t = targetsById.get(target.targetWeaponId)
    return { targetWeaponId: target.targetWeaponId, weaponTypeId: t?.weaponTypeId ?? null, elementId: t?.elementId ?? null,
      sourceKind: target.sourceKind, sourceOwnedWeaponId: target.sourceOwnedWeaponId, normalPosition: target.normalPosition, conversionPosition: target.conversionPosition,
      normal: target.normal, gogma: target.gogma, skill: target.skill, routeOperationCount: target.routeOperationCount,
      finalBonuses: target.finalBonuses, finalScope: target.finalScope, finalSeriesSkillId: target.finalSeriesSkillId, finalGroupSkillId: target.finalGroupSkillId,
      idealFull: target.idealFull, idealRequiredOnly: target.idealRequiredOnly, rngErrors: target.errors,
      materialization: m ? { method: m.method, candidateId: m.candidateId, buildListEntryId: m.buildListEntryId, routeKind: m.routeKind,
        estimated: m.estimated, plannerRequired: m.plannerRequired, deliveredCandidates: m.deliveredCandidates, matches: m.matches, error: m.error, elapsedMs: m.elapsedMs } : null }
  })
  const lowerBoundTargets = problem.targets.map(target => {
    const min = pick => Math.min(...target.options.map(pick))
    return { targetWeaponId: target.targetWeaponId, weaponTypeId: target.weaponTypeId, elementId: target.elementId,
      firstIdealSkillPosition: target.firstIdealSkillPosition, firstIdealResetPosition: target.firstIdealResetPosition, optionCount: target.options.length,
      ownedOptionCount: target.options.filter(o => o.resource.startsWith('owned:')).length,
      minSkillThreshold: target.options.length ? min(o => o.skillThreshold) : null, minGogmaThreshold: target.options.length ? min(o => o.gogmaThreshold) : null,
      minNormalThreshold: target.options.some(o => o.normalThreshold !== null) ? Math.min(...target.options.filter(o => o.normalThreshold !== null).map(o => o.normalThreshold)) : null }
  })
  const record = {
    phase: 'Issue #154 Phase 2-A.5: 1,657 physical operation oracle, Production verification and lower-bound audit',
    measuredAt: new Date().toISOString(), environment,
    verdict,
    summary: {
      targets: routes.length, ownedSourceTargets: rng.targets.filter(t => t.sourceKind === 'owned').length, newNormalSourceTargets: rng.targets.filter(t => t.sourceKind === 'new_normal').length,
      materializedBy: { candidateSearch: materialization.targets.filter(t => t.method === 'candidate_search').length, plannerAlternativeSearch: materialization.targets.filter(t => t.method === 'planner_alternative_search').length },
      skill: rng.streams.skill, gogma: rng.streams.gogma, normal: rng.streams.normal, streamAdvances: streams,
      physicalOperations: rng.physicalOperations, routeOperationSum: rng.routeOperationSum,
      stageA: { passed: rng.passed, errors: rng.errors, targetsWithErrors: rng.targets.filter(t => t.errors.length).map(t => t.targetWeaponId) },
      stageB: { passed: materialization.passed, failures: materialization.targets.filter(t => t.error || !Object.values(t.matches).every(Boolean)).map(t => t.targetWeaponId) },
      stageC: plannerSummary,
      elapsedMs: { stageA: t1 - t0, stageB: t2 - t1, stageC: t3 - t2, lowerBound: t4 - t3 },
    },
    comparison: { phase2aAutonomousResearch: 8534, historicalValidatedOracle: 2982, thisOracle: planner.steps,
      minusFromPhase2a: 8534 - planner.steps, minusFromHistorical: 2982 - planner.steps },
    lowerBound: { budget, assumptions: lowerBound.LOWER_BOUND_ASSUMPTIONS,
      crossSatisfaction: { ...problem.crossSatisfaction, masterSkillIds: { series: skillStates.seriesSkillIds.length, group: skillStates.groupSkillIds.length },
        distinctSourcePreconditionHolds: problem.crossSatisfaction.possiblePairCount === 0 },
      relaxation, singleStream, origins: { skill: problem.skillOrigin, gogma: problem.gogmaOrigin, normal: problem.normalOrigins }, targets: lowerBoundTargets },
    routes: routeSummary,
    gogmaUsage: rng.gogmaUsage,
    requiredSkillUsage: rng.requiredSkillUsage,
    requiredNormalUsage: rng.requiredNormalUsage,
    hashes: {
      manifestSha256: sha(routes),
      entriesSha256: sha(materialization.entries),
      planSha256: sha(plan),
      resultSha256: sha({ planner: plannerSummary, entries: materialization.entries, plan }),
      semanticSha256: sha({ routes, rng: { targets: rng.targets, streams: rng.streams, physicalOperations: rng.physicalOperations },
        materialization: materialization.targets.map(({ elapsedMs: _e, ...rest }) => rest), planner: { ...plannerSummary, elapsedMs: undefined },
        lowerBound: { relaxation, crossSatisfaction: problem.crossSatisfaction } }),
    },
  }
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ verdict, physicalOperations: rng.physicalOperations, stageA: rng.passed, stageB: materialization.passed,
    planner: { termination: planner.termination, steps: planner.steps, selected: planner.selectedBuildListEntries, conflicts: planner.conflicts,
      rejected: planner.rejectedBuildListEntries, warnings: planner.warnings, traceReplay: planner.traceReplay, elapsedMs: planner.elapsedMs, error: planner.error },
    crossSatisfactionPossiblePairCount: problem.crossSatisfaction.possiblePairCount, lowerBound: relaxation.minimum, lowerBoundStatus: relaxation.status, singleStream }, null, 1))
} finally {
  await server.close()
}
