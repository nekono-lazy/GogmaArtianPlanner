// Issue #154 D2-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d2.mjs (start
// attestation, discovery.jsonl, evaluations.jsonl, composition.jsonl, every child record, every G store body; the raw output when it
// exists), the registered inputs again (re-validated with validateD2Inputs(); the Phase B / D1 RESULTs through the D2 allowlists only)
// and the Export, and writes docs/PLANNER_GLOBAL_D2_RESULT.json. Every judgement (discovery replay, pools, R1, R5, R6, gate, selection,
// CMP / Z replay, parity, determinism, evidence integrity, decisions) is re-derived from the records by analyzeD2Run(), never copied
// from the runner. It reads no oracle file, module or field.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync, readFileSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { runDir: option('--run-dir'), export: option('--export'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d2.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const runPath = option('--run')
const allowNonformal = args.includes('--allow-nonformal')
const sha = value => createHash('sha256').update(value).digest('hex')
const lines = text => text.split(/\r?\n/).filter(Boolean)
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const parse = buffer => { if (buffer === null) return null; try { return JSON.parse(buffer.toString('utf8')) } catch { return null } }
const sum = values => values.reduce((a, b) => a + b, 0)
const maxOf = values => values.length === 0 ? null : Math.max(...values)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const d2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2Analysis.ts')

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d2.D2_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const attestation = attestationFile ? parse(attestationFile.raw) : null
  if (attestation === null) throw new Error('No start attestation: the run has no launch provenance.')
  const journal = file => existsSync(join(paths.runDir, file)) ? lines(readFileSync(join(paths.runDir, file), 'utf8')).map(l => JSON.parse(l)) : []
  const discoveryRows = journal('discovery.jsonl')
  const evaluationRows = journal('evaluations.jsonl')
  const compositionRows = journal('composition.jsonl')
  const evidenceIssues = [], rawConsistency = [], records = []
  const loadRecord = async (id, process, recordFile) => {
    if (recordFile === null) {
      if (process?.outcome === 'completed') evidenceIssues.push(`${id}: completed with no record file`)
      return null
    }
    const path = join(paths.runDir, recordFile.file)
    if (!existsSync(path)) { evidenceIssues.push(`${id}: the record file is missing`); return null }
    const file = await loadRaw(path)
    records.push(file.source)
    if (file.source.sha256 !== recordFile.sha256 || file.source.bytes !== recordFile.bytes) { evidenceIssues.push(`${id}: the record file is not the one the journal recorded`); return null }
    const json = parse(file.raw)
    if (json === null) evidenceIssues.push(`${id}: the record file is not JSON`)
    return json
  }
  const discoveryRecords = new Map(), poolFiles = new Map(), generatedEntries = []
  for (const row of discoveryRows) {
    const record = await loadRecord(row.unitId, row.process, row.recordFile)
    discoveryRecords.set(row.unitId, record)
    for (const p of Array.isArray(record?.result?.pooled) ? record.result.pooled : []) {
      const file = p?.generatedEntryFile?.file
      if (typeof file !== 'string') continue
      const path = join(paths.runDir, file)
      if (!existsSync(path)) { poolFiles.set(file, null); continue }
      const g = await loadRaw(path)
      generatedEntries.push(g.source)
      poolFiles.set(file, { bytes: g.source.bytes, sha256: g.source.sha256, body: parse(g.raw) })
    }
  }
  const evaluationRecords = new Map()
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.process, row.recordFile))
  const runStatus = raw === null ? 'interrupted' : raw.status
  if (raw !== null) {
    if (!same(raw.discovery ?? [], discoveryRows)) rawConsistency.push('the raw discovery rows are not discovery.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (!same(raw.composition ?? [], compositionRows)) rawConsistency.push('the raw composition rows are not composition.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD2Analysis.ts', 'scripts/analyze-planner-global-d2.mjs']
  const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
  const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
  if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
  const measuredHead = attestation.repositoryHead
  const analysisHead = git('rev-parse', 'HEAD')
  let measuredHeadIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', measuredHead, 'HEAD']) } catch { measuredHeadIsAncestor = false }
  const changedSinceMeasured = measuredHeadIsAncestor ? lines(git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths)) : []
  const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !/\.test\.tsx?$/.test(path))
  const codeHash = createHash('sha256')
  for (const file of lines(git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths))) { codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0') }
  const benchmarkCodeSha256 = codeHash.digest('hex')
  const specRaw = gitBuffer('show', `${measuredHead}:${d2.D2_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const registeredPolicySha256 = d2.d2RegisteredPolicySha256(text => sha(text))
  const firstChildStartedAt = [...discoveryRows, ...evaluationRows].map(r => r.process?.startedAt).filter(Boolean).sort()[0] ?? null

  // ---- the registered inputs, re-validated (V) from the files, the Phase B / D1 RESULTs through the allowlists only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2.D2_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const seedFiles = {}, seedSources = []
  for (const s of d2.D2_SEED_FILES) {
    const file = join(d2.D2_D1_RUN_DIR, d2.d2SeedFileName(s.unitId))
    const buffer = await readOptional(file)
    seedFiles[s.unitId] = buffer === null ? null : { file: { bytes: buffer.length, sha256: sha(buffer) }, json: parse(buffer) }
    seedSources.push({ unitId: s.unitId, file: d2.d2SeedFileName(s.unitId), bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null })
  }
  const chainedExport = d2.d2ChainedExportSha256(parse(buffers.phaseBResult))
  const attestationCheck = d2.verifyD2StartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: chainedExport, firstChildStartedAt })
  const productionChangedToMeasured = d2.d2ProductionChangedFiles(lines(git('diff', '--name-only', d2.D2_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d2.d2ProductionChangedFiles(lines(git('diff', '--name-only', d2.D2_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  const validation = d2.validateD2Inputs({ files: observed, manifest: parse(buffers.phaseBTargets), phaseBResult: parse(buffers.phaseBResult), phase2c2Result: parse(buffers.phase2c2Result),
    d1Result: parse(buffers.d1Result), seedFiles, specMarkdown: specRaw.toString('utf8'), d1SpecMarkdown: buffers.d1SpecDocument === null ? '' : buffers.d1SpecDocument.toString('utf8') })
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')

  const result = analysis.analyzeD2Run({ validated: validation, exportSha256: observed.export.sha256, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords,
    compositionRows: raw === null && compositionRows.length === 0 ? null : compositionRows, interrupted: raw === null, runEnvelopeReached: raw?.runEnvelopeReached === true, abortReason: raw?.abortReason ?? null,
    provenanceIssues, evidenceIssues, rawConsistencyIssues: rawConsistency, childProcessCount: raw === null ? null : raw.processes.length, sha256OfText: text => sha(text) })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = key => ({ file: d2.D2_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null })
  const evals = result.evaluations, units = result.discovery.units
  const heaps = [...units.map(u => u.peakHeapBytes), ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [...units.map(u => u.peakRssBytes), ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const conditions = d2.d2RegisteredConditions()
  const output = {
    phase: d2.D2_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d2.D2_SPEC_FILE, sha256: specDocumentSha256 },
      phaseB: { result: src('phaseBResult'), targetsManifest: src('phaseBTargets') },
      phase2c2Result: { file: d2.D2_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      d1: { result: src('d1Result'), generatedEntriesUsedBySeed: seedSources },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      documents: { phaseA: src('phaseADocument'), phaseB: src('phaseBDocument'), followup: src('followupDocument'), d1a: src('d1SpecDocument'), d1b: src('d1bDocument') },
      d2: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, records, generatedEntries },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      phaseBMeasuredHead: conditions.phaseBProvenance.measuredHead, d1MeasuredHead: conditions.d1Provenance.measuredHead,
      ...d2.D2_PROVENANCE_FLAGS,
      phaseBResultFieldsRead: [...d2.D2_PHASE_B_RESULT_ALLOWLIST], d1ResultFieldsRead: [...d2.D2_D1_RESULT_ALLOWLIST], d1SpecFieldsRead: [...d2.D2_D1_SPEC_FIELDS_READ],
      phaseBResultModified: observed.phaseBResult?.sha256 !== d2.D2_REGISTERED_INPUTS.phaseBResult.sha256,
      d1ResultModified: observed.d1Result?.sha256 !== d2.D2_REGISTERED_INPUTS.d1Result.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: attestation.rngEngineVersion, calculationContext: { ...d2.D2_CALCULATION_CONTEXT } },
    conditions: { population: conditions.population, context: conditions.context, ladder: conditions.ladder, poolCap: conditions.poolCap, discoveryRule: conditions.discoveryRule,
      admissionRule: conditions.admissionRule, compositionRule: conditions.compositionRule, gate: conditions.gate, selectionOrder: conditions.selectionOrder, seededAxis: conditions.seededAxis,
      budgets: conditions.budgets, order: conditions.order, executionEnvelope: conditions.executionEnvelope, researchMaxPlanSteps: conditions.researchMaxPlanSteps,
      evaluationFullRunCap: conditions.evaluationFullRunCap, r5Definition: conditions.r5Definition, r6Definition: conditions.r6Definition, supportChecks: conditions.supportChecks,
      decisionRule: conditions.decisionRule, seededDecisionRule: conditions.seededDecisionRule, betterRule: conditions.betterRule, comparisonBaselines: conditions.comparisonBaselines, notRun: conditions.notRun,
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)' },
    inputValidation: { passed: validation.passed, issues: validation.issues },
    discovery: result.discovery,
    evaluations: evals,
    parityChecks: result.parityChecks,
    composition: result.composition,
    comparison: result.comparison,
    aggregates: { ...result.aggregates,
      timing: { discoveryWallMs: sum(units.map(u => u.wallMs ?? 0)), evaluationWallMs: sum(evals.map(e => e.wallMs ?? 0)), runWallMs: raw?.wallMs ?? null, runEnvelopeReached: raw?.runEnvelopeReached === true },
      memory: { peakHeapBytes: maxOf(heaps), peakRssBytes: maxOf(rss) } },
    invalidReasons: result.invalidReasons,
    decision: result.decision,
    seededAxis: result.seededAxis,
  }
  if (!formal && !allowNonformal) throw new Error(`Not a formal run (${provenanceIssues.join('; ')}); pass --allow-nonformal for a smoke analysis.`)
  await writeFile(paths.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, runStatus, decision: output.decision.case, seeded: output.seededAxis.case, discovery: output.aggregates.discovery,
    evaluations: output.aggregates.evaluations, mainFinal: output.composition.main.finalMetrics, seededFinal: output.composition.seeded.finalMetrics, invalid: output.invalidReasons.length,
    invalidReasons: output.invalidReasons.slice(0, 20) }, null, 2))
} finally {
  await server.close()
}
