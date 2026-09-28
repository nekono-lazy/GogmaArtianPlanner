// Issue #154 Phase 2-C1 post-hoc analysis only. Reads the two finished variant records (control and
// origin-independent-canonical, written by run-planner-global-phase2c1.mjs), the Phase 2-B result (for the recorded
// Phase 2-A semantic SHA and the 37/37 stacking it measured) and the 1,657 proven-minimum evidence, all as explicit
// file arguments, AFTER both runs ended. It runs no Search and no Planner, and it feeds the optimum evidence into
// nothing but this comparison.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { control: option('--control'), origin: option('--origin'), phase2b: option('--phase2b'), optimum: option('--optimum'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c1.mjs --control <control.json> --origin <origin.json> --phase2b <PLANNER_GLOBAL_PHASE2B_RESULTS.json> --optimum <1,657 evidence.json> --output <new.json>')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const load = async path => {
  const raw = await readFile(path)
  return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } }
}
const [control, origin, phase2b, optimumFile] = await Promise.all([load(paths.control), load(paths.origin), load(paths.phase2b), load(paths.optimum)])

// Provenance: both runs measured the same committed code on the same Export.
for (const [name, record] of [['control', control.json], ['origin', origin.json]]) {
  if (record.environment.uncommittedBenchmarkCode) throw new Error(`${name} ran with uncommitted benchmark code.`)
}
for (const field of ['repositoryHead', 'benchmarkCodeSha256', 'exportSha256', 'rngEngineVersion']) {
  if (control.json.environment[field] !== origin.json.environment[field]) throw new Error(`Variant records differ in ${field}.`)
}
if (control.json.variant.id !== 'control' || origin.json.variant.id !== 'origin-independent-canonical') throw new Error('Unexpected variant records.')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const gap = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2BGapAnalysis.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C1Analysis.ts')
  const optimum = gap.parseOptimumEvidence(optimumFile.json)
  const exportSha256 = control.json.environment.exportSha256
  if (optimum.verdict !== 'proven_minimum' || optimum.exportSha256 !== exportSha256) throw new Error('Optimum evidence is not the proven minimum of this Export.')
  if (phase2b.json.expected?.exportSha256 !== exportSha256) throw new Error('Phase 2-B evidence is for another Export.')
  const c = control.json.result, o = origin.json.result
  if (!c.analysis.finished || !o.analysis.finished) throw new Error('A variant did not reach the final Planner.')

  // Control parity with Phase 1-E / 2-A / 2-B.
  const phase2bStacking = phase2b.json.gap.stacking
  const parity = {
    expectedSemanticSha256: phase2b.json.expected.phase2aSemanticSha256, controlSemanticSha256: c.semanticSha256,
    semanticShaMatches: c.semanticSha256 === phase2b.json.expected.phase2aSemanticSha256,
    phase2bStacking: { total: phase2bStacking.total, startsAtOrAfterFrontier: phase2bStacking.startsAtOrAfterFrontier },
    controlStacking: c.analysis.stacking.all,
    stackingMatches: c.analysis.stacking.all.total === phase2bStacking.total && c.analysis.stacking.all.startsAtOrAfterFrontier === phase2bStacking.startsAtOrAfterFrontier,
    controlPhysicalMatchesPhase2B: c.analysis.final?.physical?.physicalOperations === phase2b.json.gap.totals.autonomous,
  }
  if (!parity.semanticShaMatches || !parity.stackingMatches || !parity.controlPhysicalMatchesPhase2B) throw new Error(`Control does not reproduce Phase 2-A / 2-B: ${JSON.stringify(parity)}`)

  const comparison = analysis.comparePhase2C1({ control: c.analysis, origin: o.analysis, optimum })
  const phase2bCategories = phase2b.json.gap.categories
  const finalOf = run => ({ status: run.report.status, completed: run.analysis.final.completedTargetCount, planningTargets: run.analysis.final.planningTargetCount,
    selected: run.analysis.final.selected, conflicts: run.analysis.final.conflicts, conflictsByKind: run.analysis.final.conflictsByKind,
    rejected: run.analysis.final.rejected, rejectedByReason: run.analysis.final.rejectedByReason, resourceConflictRejected: run.analysis.final.resourceConflictRejected,
    warnings: run.analysis.final.warningsByKind, planSteps: run.analysis.final.planSteps, physicalOperations: run.analysis.final.physical?.physicalOperations ?? null,
    expandedStates: run.analysis.final.expandedStates, traceReplay: run.analysis.final.traceReplay, termination: run.analysis.final.termination.status })
  const record = {
    phase: 'Issue #154 Phase 2-C1: origin-independent canonical Candidate Search (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { control: control.source, origin: origin.source, phase2b: phase2b.source, optimum: optimumFile.source },
    provenance: { measuredCommit: control.json.environment.repositoryHead, benchmarkCodeSha256: control.json.environment.benchmarkCodeSha256,
      uncommittedBenchmarkCode: false, exportFileName: control.json.environment.exportFileName, exportSha256, exportBytes: control.json.environment.exportBytes,
      environment: { ...control.json.environment, repositoryHead: undefined, benchmarkCodeSha256: undefined, uncommittedBenchmarkCode: undefined },
      runs: { control: { measuredAt: control.json.measuredAt, wallMs: control.json.wallMs, memory: control.json.memory },
        origin: { measuredAt: origin.json.measuredAt, wallMs: origin.json.wallMs, memory: origin.json.memory } } },
    variants: { control: control.json.variant, origin: origin.json.variant },
    controlParity: parity,
    control: { final: finalOf(c), retained: c.analysis.retainedCount, pending: c.analysis.pendingCount, candidateCounts: c.analysis.candidateCounts,
      searchOrigin: c.analysis.searchOrigin, stacking: { all: c.analysis.stacking.all, gogma: c.analysis.stacking.gogma, skill: c.analysis.stacking.skill },
      staticEnvelope: c.analysis.staticEnvelope, collisions: c.analysis.collisions, timing: c.timing, semanticSha256: c.semanticSha256, planSha256: c.evidence.planSha256 },
    origin: { final: finalOf(o), retained: o.analysis.retainedCount, pending: o.analysis.pendingCount, retainedOriginalEntryIds: o.report.retainedOriginalEntryIds,
      discoveryOrder: o.analysis.discoveryOrder, searchOrigin: o.analysis.searchOrigin, candidateCounts: o.analysis.candidateCounts, candidates: o.analysis.candidates,
      finalDetails: { conflictDetails: o.analysis.final.conflictDetails, rejectedDetails: o.analysis.final.rejectedDetails, notSelectedTargets: o.analysis.final.notSelectedTargets,
        selectedByEntryOrigin: o.analysis.final.selectedByEntryOrigin, conflictParticipantTargets: o.analysis.final.conflictParticipantTargets, physical: o.analysis.final.physical },
      staticEnvelope: o.analysis.staticEnvelope, collisions: o.analysis.collisions, stacking: o.analysis.stacking, baselineComparison: o.baselineComparison,
      routes: o.analysis.routes, routeOperationSum: o.analysis.routeOperationSum, timing: o.timing, semanticSha256: o.semanticSha256, planSha256: o.evidence.planSha256,
      finalResultSha256: o.evidence.finalResultSha256 },
    controlBaselineComparison: c.baselineComparison,
    comparison: { ...comparison,
      phase2bRecordedAgainstControl: { sourceChangedTargets: 43 - (phase2bCategories['source:same_owned_weapon']?.targets ?? 0) - (phase2bCategories['source:new_normal_same_position']?.targets ?? 0),
        heldRoutes: phase2bCategories.optimum_crosses_held_positions?.targets ?? null,
        sharedCoverageGogma: phase2bCategories['optimum_relies_on_shared_coverage:gogma']?.targets ?? null,
        sharedCoverageSkill: phase2bCategories['optimum_relies_on_shared_coverage:skill']?.targets ?? null } },
    table: {
      control: { physical: c.analysis.final.physical?.physicalOperations ?? null, completed: c.analysis.final.completedTargetCount, conflicts: c.analysis.final.conflicts,
        rejected: c.analysis.final.rejected, generated: c.analysis.candidateCounts.found, stacking: c.analysis.stacking.all,
        virtualStreamEnvelopeCost: c.analysis.staticEnvelope.finalInput.virtualStreamEnvelopeCost },
      origin: { planSteps: o.analysis.final.planSteps, physical: o.analysis.final.physical?.physicalOperations ?? null, completed: o.analysis.final.completedTargetCount,
        selected: o.analysis.final.selected, conflicts: o.analysis.final.conflicts, rejected: o.analysis.final.rejected, found: o.analysis.candidateCounts.found,
        stacking: o.analysis.stacking.all, virtualStreamEnvelopeCost: o.analysis.staticEnvelope.finalInput.virtualStreamEnvelopeCost,
        sourceCollisionOwnedWeapons: o.analysis.collisions.sourceCollisions.length, requiredPositionCollisions: o.analysis.collisions.requiredPositionCollisionCounts },
      optimum: { physical: optimum.physicalOperations, completed: optimum.routes.length, conflicts: 0 },
    },
  }
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), parity, table: record.table, sourceRelationToOptimum: comparison.sourceRelationToOptimum,
    requiredPositionsMatchOptimum: comparison.requiredPositionsMatchOptimum, streams: comparison.streams }, null, 2))
} finally {
  await server.close()
}
