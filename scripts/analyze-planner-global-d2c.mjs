// Issue #154 D2-C-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d2c.mjs (start
// attestation, contexts.jsonl, discovery.jsonl, evaluations.jsonl, composition.jsonl, every CTX / child record, every G store body;
// the raw output when it exists), the registered inputs again (re-validated with validateD2CInputs(); the D2 / Phase B RESULTs
// through the D2-C allowlists only) and the Export, recomputes the Planner-start origin digest (C4), and writes
// docs/PLANNER_GLOBAL_D2C_RESULT.json. Every judgement (C1 .. C5, discovery replay, D-1 .. D-4, pools, ordinals, R1, R5, S1 .. S5,
// R6, gate, selection, CMP replay, parity, determinism, evidence integrity, the decision) is re-derived from the records by
// analyzeD2CRun(), never copied from the runner. It reads no oracle file, module or field.
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
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d2c.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
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
  const d2c = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2C.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2CAnalysis.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const searchOrigin = await server.ssrLoadModule('/src/domain/planner/replacement/plannerSearchOrigin.ts')
  const hashing = await server.ssrLoadModule('/src/domain/models/hashing.ts')

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d2c.D2C_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const attestation = attestationFile ? parse(attestationFile.raw) : null
  if (attestation === null) throw new Error('No start attestation: the run has no launch provenance.')
  const journal = file => existsSync(join(paths.runDir, file)) ? lines(readFileSync(join(paths.runDir, file), 'utf8')).map(l => JSON.parse(l)) : []
  const contextRows = journal('contexts.jsonl')
  const discoveryRows = journal('discovery.jsonl')
  const evaluationRows = journal('evaluations.jsonl')
  const compositionRows = journal('composition.jsonl')
  const evidenceIssues = [], rawConsistency = [], contextRecordSources = [], records = []
  const loadRecord = async (id, process, recordFile, sink) => {
    if (recordFile === null) {
      if (process?.outcome === 'completed') evidenceIssues.push(`${id}: completed with no record file`)
      return null
    }
    const path = join(paths.runDir, recordFile.file)
    if (!existsSync(path)) { evidenceIssues.push(`${id}: the record file is missing`); return null }
    const file = await loadRaw(path)
    sink.push(file.source)
    if (file.source.sha256 !== recordFile.sha256 || file.source.bytes !== recordFile.bytes) { evidenceIssues.push(`${id}: the record file is not the one the journal recorded`); return null }
    const json = parse(file.raw)
    if (json === null) evidenceIssues.push(`${id}: the record file is not JSON`)
    return json
  }
  const contextRecords = new Map()
  for (const row of contextRows) contextRecords.set(row.unitId, await loadRecord(row.unitId, row.process, row.recordFile, contextRecordSources))
  const discoveryRecords = new Map(), poolFiles = new Map(), generatedEntries = []
  for (const row of discoveryRows) {
    const record = await loadRecord(row.unitId, row.process, row.recordFile, records)
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
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.process, row.recordFile, records))
  const runStatus = raw === null ? 'interrupted' : raw.status
  if (raw !== null) {
    if (!same(raw.contexts ?? [], contextRows)) rawConsistency.push('the raw context rows are not contexts.jsonl')
    if (!same(raw.discovery ?? [], discoveryRows)) rawConsistency.push('the raw discovery rows are not discovery.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (!same(raw.composition ?? [], compositionRows)) rawConsistency.push('the raw composition rows are not composition.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD2CAnalysis.ts', 'scripts/analyze-planner-global-d2c.mjs']
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
  const specRaw = gitBuffer('show', `${measuredHead}:${d2c.D2C_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const registeredPolicySha256 = d2c.d2cRegisteredPolicySha256(text => sha(text))
  const firstChildStartedAt = [...contextRows, ...discoveryRows, ...evaluationRows].map(r => r.process?.startedAt).filter(Boolean).sort()[0] ?? null

  // ---- the registered inputs, re-validated (V) from the files, the D2 / Phase B RESULTs through the allowlists only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2c.D2C_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const i0Files = {}, i0Sources = []
  for (const f of d2c.D2C_I0_FILES) {
    const buffer = await readOptional(join(d2c.D2C_D2B_RUN_DIR, f.file))
    i0Files[f.file] = buffer === null ? null : { file: { bytes: buffer.length, sha256: sha(buffer) }, json: parse(buffer) }
    i0Sources.push({ file: `${d2c.D2C_D2B_RUN_DIR}/${f.file}`, bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null })
  }
  const phaseBTasks = {}, phaseBRecords = {}, taskSources = [], recordSources = []
  for (const u of d2c.D2C_PHASE_B_UNITS) {
    for (const [name, target, sink] of [[d2c.d2cPhaseBTaskFileName(u.unitId), phaseBTasks, taskSources], [d2c.d2cPhaseBRecordFileName(u.unitId), phaseBRecords, recordSources]]) {
      const buffer = await readOptional(join(d2c.D2C_PHASE_B_RUN_DIR, name))
      target[u.unitId] = buffer === null ? null : { file: { bytes: buffer.length, sha256: sha(buffer) }, json: parse(buffer) }
      sink.push({ file: `${d2c.D2C_PHASE_B_RUN_DIR}/${name}`, bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null })
    }
  }
  const chainedExport = d2c.d2cChainedExportSha256(parse(buffers.phaseBResult))
  const attestationCheck = d2c.verifyD2CStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: chainedExport, firstChildStartedAt })
  const productionChangedToMeasured = d2c.d2cProductionChangedFiles(lines(git('diff', '--name-only', d2c.D2C_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d2c.d2cProductionChangedFiles(lines(git('diff', '--name-only', d2c.D2C_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  const validation = d2c.validateD2CInputs({ files: observed, manifest: parse(buffers.phaseBTargets), d2Result: parse(buffers.d2Result), phaseBResult: parse(buffers.phaseBResult),
    phase2c2Result: parse(buffers.phase2c2Result), i0Files, phaseBTasks, phaseBRecords, exportBuildListEntries: exportJson.buildListEntries,
    specMarkdown: specRaw.toString('utf8'), d1SpecMarkdown: buffers.d1SpecDocument === null ? '' : buffers.d1SpecDocument.toString('utf8') })
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')
  // C4: the Planner-start origin digest, recomputed from the Export independently of the CTX children.
  const recomputedOriginDigest = hashing.hashStableValue(searchOrigin.createPlannerStartSearchOrigin(research.globalResearchInputFromExport(exportJson, d2c.D2C_RESEARCH_MAX_PLAN_STEPS)))

  const result = analysis.analyzeD2CRun({ validated: validation, exportSha256: observed.export.sha256, exportBuildListEntries: exportJson.buildListEntries, recomputedOriginDigest,
    contextRows, contextRecords, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords,
    compositionRows: raw === null && compositionRows.length === 0 ? null : compositionRows, interrupted: raw === null, discoveryEnvelopeReached: raw?.discoveryEnvelopeReached === true,
    runEnvelopeReached: raw?.runEnvelopeReached === true, abortReason: raw?.abortReason ?? null, provenanceIssues, evidenceIssues, rawConsistencyIssues: rawConsistency,
    childProcessCount: raw === null ? null : raw.processes.length, sha256OfText: text => sha(text) })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = key => ({ file: d2c.D2C_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null })
  const evals = result.evaluations, units = result.discovery.units, ctxs = result.contexts
  const heaps = [...ctxs.map(c => c.peakHeapBytes), ...units.map(u => u.peakHeapBytes), ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [...ctxs.map(c => c.peakRssBytes), ...units.map(u => u.peakRssBytes), ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const conditions = d2c.d2cRegisteredConditions()
  const output = {
    phase: d2c.D2C_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d2c.D2C_SPEC_FILE, sha256: specDocumentSha256 },
      d2: { result: src('d2Result'), generatedEntriesUsedByI0: i0Sources },
      phaseB: { result: src('phaseBResult'), targetsManifest: src('phaseBTargets'), tasks: taskSources, records: recordSources },
      phase2c2Result: { file: d2c.D2C_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      documents: { d2a: src('d2SpecDocument'), d2b: src('d2bDocument'), d1a: src('d1SpecDocument'), phaseA: src('phaseADocument'), phaseB: src('phaseBDocument'), followup: src('followupDocument'), d1b: src('d1bDocument') },
      d2c: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, contextRecords: contextRecordSources, records, generatedEntries },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      d2MeasuredHead: conditions.d2Provenance.measuredHead, phaseBMeasuredHead: conditions.phaseBProvenance.measuredHead,
      ...d2c.D2C_PROVENANCE_FLAGS,
      d2ResultFieldsRead: [...d2c.D2C_D2_RESULT_ALLOWLIST], phaseBResultFieldsRead: [...d2c.D2C_PHASE_B_RESULT_ALLOWLIST], phaseBTaskFieldsRead: [...d2c.D2C_PHASE_B_TASK_FIELDS_READ],
      phaseBRecordFieldsRead: [...d2c.D2C_PHASE_B_RECORD_FIELDS_READ], d1SpecFieldsRead: [...d2c.D2C_D1_SPEC_FIELDS_READ],
      d2ResultModified: observed.d2Result?.sha256 !== d2c.D2C_REGISTERED_INPUTS.d2Result.sha256,
      phaseBResultModified: observed.phaseBResult?.sha256 !== d2c.D2C_REGISTERED_INPUTS.phaseBResult.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: attestation.rngEngineVersion, calculationContext: attestation.observedCalculationContext },
    conditions: { scopeTargets: validation.scopeTargets.map(t => t.label), contexts: validation.contexts.map(c => ({ k: c.k, contextId: c.contextId, label: c.label, targetWeaponId: c.targetWeaponId,
      currentBuildListEntryId: c.currentBuildListEntryId, supportBuildListEntryId: c.supportBuildListEntryId, observations: c.observations, observedEvaluations: c.observedEvaluations, orderInTarget: c.orderInTarget,
      phaseBUnitIds: c.phaseBUnits.map(u => u.unitId), registeredReservationDigest: c.registeredReservationDigest })),
      derivationRule: conditions.derivationRule, supportCapPerTarget: conditions.supportCapPerTarget, k1PoolCap: conditions.k1PoolCap, ladder: conditions.ladder, dedupRules: conditions.dedupRules,
      discoveryRule: conditions.discoveryRule, admissionRule: conditions.admissionRule, incumbent: conditions.incumbent, compositionRule: conditions.compositionRule, r5Definition: conditions.r5Definition,
      gate: conditions.gate, selectionOrder: conditions.selectionOrder, r6Definition: conditions.r6Definition, contextChecks: conditions.contextChecks, supportChecks: conditions.supportChecks,
      supportExpiryCauses: conditions.supportExpiryCauses, budgets: conditions.budgets, order: conditions.order, executionEnvelope: conditions.executionEnvelope, researchMaxPlanSteps: conditions.researchMaxPlanSteps,
      evaluationFullRunCap: conditions.evaluationFullRunCap, decisionRule: conditions.decisionRule, betterRule: conditions.betterRule, comparisonBaselines: conditions.comparisonBaselines, notRun: conditions.notRun,
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)',
      i0RunnerStage: 'I0 is evaluated by runD2Evaluation() with the D2 stage Z0 (replacement_set, no found_R diagnostic)',
      d2bDeterminismScope: 'the D2 RESULT evaluations of the allowlisted stages B0 / ADM / CMP / Z (Z0 is outside the §10.1 allowlist; no D2-C replacement set can equal the Z0 set, which holds the D1 t09 K1 seed and no t06)' },
    inputValidation: { passed: validation.passed, issues: validation.issues, derivedContexts: validation.contexts.map(c => ({ contextId: c.contextId, targetWeaponId: c.targetWeaponId,
      supportBuildListEntryId: c.supportBuildListEntryId, observations: c.observations, observedEvaluations: c.observedEvaluations, b0Selected: c.b0Selected })),
      winners: validation.derivation?.winners ?? [] },
    contexts: ctxs,
    discovery: result.discovery,
    evaluations: evals,
    parityChecks: result.parityChecks,
    composition: result.composition,
    comparison: result.comparison,
    aggregates: { ...result.aggregates,
      timing: { contextWallMs: sum(ctxs.map(c => c.wallMs ?? 0)), discoveryWallMs: sum(units.map(u => u.wallMs ?? 0)), evaluationWallMs: sum(evals.map(e => e.wallMs ?? 0)), runWallMs: raw?.wallMs ?? null,
        discoveryEnvelopeReached: raw?.discoveryEnvelopeReached === true, runEnvelopeReached: raw?.runEnvelopeReached === true },
      memory: { peakHeapBytes: maxOf(heaps), peakRssBytes: maxOf(rss) } },
    invalidReasons: result.invalidReasons,
    decision: result.decision,
  }
  if (!formal && !allowNonformal) throw new Error(`Not a formal run (${provenanceIssues.join('; ')}); pass --allow-nonformal for a smoke analysis.`)
  await writeFile(paths.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, runStatus, decision: output.decision.case, contexts: ctxs.map(c => `${c.contextId}:${c.status}/${c.discoveryStop}`),
    discovery: output.aggregates.discovery, evaluations: output.aggregates.evaluations, final: output.composition.main.finalMetrics, k1Accepted: output.decision.k1Accepted,
    invalid: output.invalidReasons.length, invalidReasons: output.invalidReasons.slice(0, 20) }, null, 2))
} finally {
  await server.close()
}
