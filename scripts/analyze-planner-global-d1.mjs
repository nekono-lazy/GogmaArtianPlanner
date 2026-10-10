// Issue #154 D1-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d1.mjs (start
// attestation, redeliveries.jsonl, evaluations.jsonl, every child record, every G store body; the raw output when it exists), the
// registered inputs again (re-validated with validateD1Inputs(); the Phase B RESULT through the D1 allowlist only) and the Export,
// and writes docs/PLANNER_GLOBAL_D1_RESULT.json. Every judgement (R status, R5, parity, baseline diff, A(c) replay, determinism,
// decision) is re-derived from the records by analyzeD1Run(), never copied from the runner. It reads no oracle file, module or field.
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
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d1.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
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
  const d1 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD1Analysis.ts')

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d1.D1_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const attestation = attestationFile ? parse(attestationFile.raw) : null
  if (attestation === null) throw new Error('No start attestation: the run has no launch provenance.')
  const journal = file => existsSync(join(paths.runDir, file)) ? lines(readFileSync(join(paths.runDir, file), 'utf8')).map(l => JSON.parse(l)) : []
  const redeliveryRows = journal('redeliveries.jsonl')
  const evaluationRows = journal('evaluations.jsonl')
  const rawConsistency = []
  const records = []
  const loadRecord = async (id, recordFile) => {
    if (recordFile === null) return null
    const path = join(paths.runDir, recordFile.file)
    if (!existsSync(path)) { rawConsistency.push(`${id}: the record file is missing`); return null }
    const file = await loadRaw(path)
    records.push(file.source)
    if (file.source.sha256 !== recordFile.sha256 || file.source.bytes !== recordFile.bytes) rawConsistency.push(`${id}: the record file is not the one the journal recorded`)
    return parse(file.raw)
  }
  const redeliveryRecords = new Map(), generatedEntries = new Map(), generatedEntrySources = []
  for (const row of redeliveryRows) {
    redeliveryRecords.set(row.unitId, await loadRecord(row.unitId, row.recordFile))
    const gPath = join(paths.runDir, `${row.unitId}.generated-entry.json`)
    if (existsSync(gPath)) {
      const g = await loadRaw(gPath)
      generatedEntrySources.push(g.source)
      generatedEntries.set(row.unitId, { bytes: g.source.bytes, sha256: g.source.sha256, body: parse(g.raw) })
    } else generatedEntries.set(row.unitId, null)
  }
  const evaluationRecords = new Map()
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.recordFile))
  const runStatus = raw === null ? 'interrupted' : raw.status
  if (raw !== null) {
    if (!same(raw.redeliveries ?? [], redeliveryRows)) rawConsistency.push('the raw R rows are not redeliveries.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD1Analysis.ts', 'scripts/analyze-planner-global-d1.mjs']
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
  const specRaw = gitBuffer('show', `${measuredHead}:${d1.D1_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const firstChildStartedAt = [...redeliveryRows, ...evaluationRows].map(r => r.process?.startedAt).filter(Boolean).sort()[0] ?? null
  const phaseBAttestationRaw = existsSync(d1.D1_REGISTERED_INPUTS.phaseBAttestation.file) ? await readFile(d1.D1_REGISTERED_INPUTS.phaseBAttestation.file) : null
  const attestationCheck = d1.verifyD1StartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256,
    exportSha256: d1.d1ChainedExportSha256(parse(phaseBAttestationRaw)), firstChildStartedAt })
  const productionChangedToMeasured = d1.d1ProductionChangedFiles(lines(git('diff', '--name-only', d1.D1_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d1.d1ProductionChangedFiles(lines(git('diff', '--name-only', d1.D1_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  // ---- the registered inputs, re-validated (V) from the files, the Phase B RESULT through the allowlist only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d1.D1_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const unitRecords = {}, unitTasks = {}, foundUnitRecords = [], foundUnitTasks = []
  for (const unit of d1.D1_FOUND_UNITS) {
    const record = await readOptional(join(d1.D1_PHASE_B_RUN_DIR, `${unit.unitId}.record.json`))
    const task = await readOptional(join(d1.D1_PHASE_B_RUN_DIR, `${unit.unitId}.task.json`))
    unitRecords[unit.unitId] = record === null ? null : { file: { bytes: record.length, sha256: sha(record) }, json: parse(record) }
    unitTasks[unit.unitId] = task === null ? null : { file: { bytes: task.length, sha256: sha(task) }, json: parse(task) }
    foundUnitRecords.push({ unitId: unit.unitId, file: `${unit.unitId}.record.json`, bytes: record?.length ?? null, sha256: record ? sha(record) : null })
    foundUnitTasks.push({ unitId: unit.unitId, file: `${unit.unitId}.task.json`, bytes: task?.length ?? null, sha256: task ? sha(task) : null })
  }
  const phase2c2 = parse(buffers.phase2c2Result)
  const validation = d1.validateD1Inputs({ files: observed, phaseBResult: parse(buffers.phaseBResult), phaseBRaw: parse(buffers.phaseBRaw), phaseBAttestation: parse(buffers.phaseBAttestation),
    phase2c2Result: phase2c2, unitRecords, unitTasks, specMarkdown: specRaw.toString('utf8') }, text => sha(text))
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')

  const result = analysis.analyzeD1Run({ targets: validation.targets, inputValidation: { passed: validation.passed, issues: validation.issues },
    phase2c2BaselineSummary: phase2c2?.baseline?.summary ?? null, exportSha256: observed.export.sha256, redeliveryRows, redeliveryRecords, generatedEntries, evaluationRows, evaluationRecords,
    interrupted: raw === null, provenanceIssues, rawConsistencyIssues: rawConsistency, childProcessCount: raw === null ? null : raw.processes.length })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = (key, extra = {}) => ({ file: d1.D1_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null, ...extra })
  const evals = result.evaluations
  const walls = [...result.redelivery.map(r => r.wallMs), ...evals.map(e => e.wallMs)].filter(v => typeof v === 'number')
  const heaps = [...result.redelivery.map(r => r.peakHeapBytes), ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [...result.redelivery.map(r => r.peakRssBytes), ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const output = {
    phase: d1.D1_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d1.D1_SPEC_FILE, sha256: specDocumentSha256 },
      phaseB: { result: src('phaseBResult'), raw: src('phaseBRaw'), attestation: src('phaseBAttestation'), tasksRecord: src('phaseBTasksRecord'), targetsManifest: src('phaseBTargets') },
      phase2c2Result: { file: d1.D1_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      documents: { phaseA: src('phaseADocument'), phaseB: src('phaseBDocument'), followup: src('followupDocument') },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      foundUnitRecords, foundUnitTasks,
      d1: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, records, generatedEntries: generatedEntrySources },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      phaseBMeasuredHead: d1.D1_PHASE_B_PROVENANCE.measuredHead,
      ...d1.D1_PROVENANCE_FLAGS,
      phaseBResultFieldsRead: [...d1.D1_PHASE_B_RESULT_ALLOWLIST],
      phaseBResultModified: observed.phaseBResult?.sha256 !== d1.D1_REGISTERED_INPUTS.phaseBResult.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: d1.D1_RNG_ENGINE_VERSION, calculationContext: { ...d1.D1_CALCULATION_CONTEXT } },
    conditions: { stages: d1.d1RegisteredEvaluations().map(e => ({ evaluationId: e.evaluationId, stage: e.stage, evaluatedAgainst: e.evaluatedAgainst })), order: attestation.order,
      executionEnvelope: { ...d1.D1_EXECUTION_ENVELOPE }, researchMaxPlanSteps: d1.D1_RESEARCH_MAX_PLAN_STEPS, evaluationFullRunCap: d1.D1_EVALUATION_FULL_RUN_CAP,
      r5Definition: [...d1.D1_R5_DEFINITION], supportChecks: [...d1.D1_SUPPORT_CHECKS], decisionRule: [...d1.D1_DECISION_RULE], notRun: [...d1.D1_NOT_RUN],
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)' },
    inputValidation: { passed: validation.passed, issues: validation.issues },
    redelivery: result.redelivery,
    evaluations: evals,
    aggregates: { ...result.aggregates,
      timing: { totalChildWallMs: sum(walls), redeliveryWallMs: sum(result.redelivery.map(r => r.wallMs ?? 0)), evaluationWallMs: sum(evals.map(e => e.wallMs ?? 0)), runWallMs: raw?.wallMs ?? null },
      memory: { peakHeapBytes: maxOf(heaps), peakRssBytes: maxOf(rss) } },
    invalidReasons: result.invalidReasons,
    decision: result.decision,
  }
  if (!formal && !allowNonformal) throw new Error(`Not a formal run (${provenanceIssues.join('; ')}); pass --allow-nonformal for a smoke analysis.`)
  await writeFile(paths.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, runStatus, decision: output.decision, redelivery: output.aggregates.redelivery, evaluations: output.aggregates.evaluations,
    r5: output.aggregates.r5, invalid: output.invalidReasons.length }, null, 2))
} finally {
  await server.close()
}
