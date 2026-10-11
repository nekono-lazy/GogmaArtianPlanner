// Issue #154 D2-E-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d2e.mjs (start
// attestation, rv.jsonl, contexts.jsonl, discovery.jsonl, evaluations.jsonl, the RV / CTX-K2 / DSC / evaluation records, the K2 G
// store; the raw output when it exists), the registered inputs again (re-validated with validateD2EInputs(); the D2-D / D2-C / D2
// RESULTs through the D2-E allowlists only, the CTX records through readD2EContextRecord()), the 9 incumbent G store bodies and the
// Export, and writes docs/PLANNER_GLOBAL_D2E_RESULT.json. Every judgement (RV1 .. RV6, C1 .. C7, the rung progression, D-1 .. D-5,
// R0-K2 / R0-split, R1, S1 .. S6, R5, the EXT diagnostics, gate, improved, R6, parity, determinism, evidence integrity, the decision)
// is re-derived from the records by analyzeD2ERun(), never copied from the runner. It reads no oracle file, module or field.
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
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d2e.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
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
  const d2e = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2E.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2EAnalysis.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const searchOrigin = await server.ssrLoadModule('/src/domain/planner/replacement/plannerSearchOrigin.ts')
  const hashing = await server.ssrLoadModule('/src/domain/models/hashing.ts')
  const ProductionRngEngine = (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d2e.D2E_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const attestation = attestationFile ? parse(attestationFile.raw) : null
  if (attestation === null) throw new Error('No start attestation: the run has no launch provenance.')
  const journal = file => existsSync(join(paths.runDir, file)) ? lines(readFileSync(join(paths.runDir, file), 'utf8')).map(l => JSON.parse(l)) : []
  const rvRows = journal('rv.jsonl')
  const contextRows = journal('contexts.jsonl')
  const discoveryRows = journal('discovery.jsonl')
  const evaluationRows = journal('evaluations.jsonl')
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
  if (rvRows.length > 1) evidenceIssues.push(`${rvRows.length} RV rows, not at most 1`)
  if (contextRows.length > 1) evidenceIssues.push(`${contextRows.length} CTX-K2 rows, not at most 1`)
  const rvRow = rvRows[0] ?? null
  const rvRecord = rvRow === null ? null : await loadRecord('RV', rvRow.process, rvRow.recordFile)
  const rvRecordSource = rvRow?.recordFile ? records.find(r => r.file === rvRow.recordFile.file) ?? null : null
  const contextRow = contextRows[0] ?? null
  const contextRecord = contextRow === null ? null : await loadRecord('CTX-K2', contextRow.process, contextRow.recordFile)
  const contextRecordSource = contextRow?.recordFile ? records.find(r => r.file === contextRow.recordFile.file) ?? null : null
  const discoveryRecords = new Map()
  for (const row of discoveryRows) discoveryRecords.set(row.unitId, await loadRecord(row.unitId, row.process, row.recordFile))
  const discoverySources = discoveryRows.filter(r => r.recordFile).map(r => records.find(x => x.file === r.recordFile.file)).filter(Boolean)
  const evaluationRecords = new Map()
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.process, row.recordFile))
  // The K2 G store files the children wrote (read back by name; the analysis checks them against the records).
  const poolFiles = new Map(), generatedEntrySources = []
  for (const [unitId, record] of discoveryRecords) {
    const pooled = Array.isArray(record?.result?.pooled) ? record.result.pooled : []
    for (const p of pooled) {
      const name = p?.generatedEntryFile?.file
      if (typeof name !== 'string') continue
      const path = join(paths.runDir, name)
      if (!existsSync(path)) { poolFiles.set(name, null); evidenceIssues.push(`${unitId}: the G store file ${name} is missing`); continue }
      const file = await loadRaw(path)
      poolFiles.set(name, { bytes: file.source.bytes, sha256: file.source.sha256, body: parse(file.raw) })
      generatedEntrySources.push(file.source)
    }
  }
  const runStatus = raw === null ? 'interrupted' : raw.status
  if (raw !== null) {
    if (!same(raw.rv ?? null, rvRow)) rawConsistency.push('the raw RV row is not rv.jsonl')
    if (!same(raw.context ?? null, contextRow)) rawConsistency.push('the raw CTX-K2 row is not contexts.jsonl')
    if (!same(raw.discovery ?? [], discoveryRows)) rawConsistency.push('the raw discovery rows are not discovery.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD2EAnalysis.ts', 'scripts/analyze-planner-global-d2e.mjs']
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
  const specRaw = gitBuffer('show', `${measuredHead}:${d2e.D2E_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const registeredPolicySha256 = d2e.d2eRegisteredPolicySha256(text => sha(text))
  const firstChildStartedAt = [rvRow, contextRow, ...discoveryRows, ...evaluationRows].map(r => r?.process?.startedAt).filter(Boolean).sort()[0] ?? null

  // ---- the registered inputs, re-validated (V) from the files, the D2-D / D2-C / D2 RESULTs through the allowlists only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2e.D2E_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const d2dProjection = d2e.projectD2ED2DResult(parse(buffers.d2dResult))
  const d2cProjection = d2e.projectD2ED2CResult(parse(buffers.d2cResult))
  const documents = {}, chainedDocuments = {}, documentSources = {}
  for (const key of d2e.D2E_CHAINED_DOCUMENT_KEYS) {
    const ref = d2dProjection?.sources.documents[key] ?? null
    chainedDocuments[key] = ref?.sha256 ?? null
    const buffer = ref === null ? null : await readOptional(ref.file)
    documents[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    documentSources[key] = { file: ref?.file ?? null, bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null }
  }
  const gStoreFiles = {}, incumbentBodies = new Map(), gStoreSources = []
  for (const f of d2e.D2E_INCUMBENT_G_STORE_FILES) {
    const buffer = await readOptional(join(f.runDir, f.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    gStoreFiles[d2e.d2eGStoreKey(f.label, f.ordinal)] = buffer === null ? null : { file: o, json: parse(buffer) }
    incumbentBodies.set(f.file, buffer === null ? null : { ...o, body: parse(buffer) })
    gStoreSources.push({ file: `${f.runDir}/${f.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const contextRecords = {}, contextSources = []
  for (const c of d2e.D2E_CONTEXT_RECORDS) {
    const buffer = await readOptional(join(d2e.D2E_D2C_PROVENANCE.runDir, c.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    contextRecords[c.k] = buffer === null ? null : { file: o, json: parse(buffer) }
    contextSources.push({ file: `${d2e.D2E_D2C_PROVENANCE.runDir}/${c.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const attestationCheck = d2e.verifyD2EStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: d2e.d2eChainedExportSha256(parse(buffers.d2dResult)), chainedDocuments, firstChildStartedAt })
  const productionChangedToMeasured = d2e.d2eProductionChangedFiles(lines(git('diff', '--name-only', d2e.D2E_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d2e.d2eProductionChangedFiles(lines(git('diff', '--name-only', d2e.D2E_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  const validation = d2e.validateD2EInputs({ files: observed, documents, gStoreFiles, contextRecords, d2dResult: parse(buffers.d2dResult), d2cResult: parse(buffers.d2cResult), d2Result: parse(buffers.d2Result),
    phase2c2Result: parse(buffers.phase2c2Result), exportBuildListEntries: exportJson.buildListEntries, specMarkdown: specRaw.toString('utf8') })
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')
  // RV2 / C4, recomputed: the baseline Entries and the Planner-start origin the analyzer builds from the Export independently of the children.
  const baselineInput = research.globalResearchInputFromExport(exportJson, d2e.D2E_RESEARCH_MAX_PLAN_STEPS)
  const recomputedOriginDigest = hashing.hashStableValue(searchOrigin.createPlannerStartSearchOrigin(baselineInput))
  // C3, recomputed: the support route unit plans with the registered Production RNG Engine the analyzer instantiates itself.
  const rngEngine = new ProductionRngEngine()
  if (rngEngine.version !== d2e.D2E_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: the analyzer cannot recompute C3 with the registered Engine.')

  const result = analysis.analyzeD2ERun({ validated: validation, exportSha256: observed.export.sha256, exportBuildListEntries: exportJson.buildListEntries, baselineBuildListEntries: baselineInput.buildListEntries,
    recomputedOriginDigest, d2cContexts: d2cProjection?.contexts ?? [], rngEngine, incumbentBodies, rvRow, rvRecord, contextRow, contextRecord, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords,
    interrupted: raw === null, discoveryEnvelopeReached: raw?.discoveryEnvelopeReached === true, runEnvelopeReached: raw?.runEnvelopeReached === true, abortReason: raw?.abortReason ?? null, provenanceIssues, evidenceIssues,
    rawConsistencyIssues: rawConsistency, childProcessCount: raw === null ? null : raw.processes.length, sha256OfText: text => sha(text) })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = key => ({ file: d2e.D2E_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null })
  const evals = result.evaluations
  const heaps = [result.rv.peakHeapBytes, result.context.peakHeapBytes, ...result.discovery.units.map(u => u.peakHeapBytes), ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [result.rv.peakRssBytes, result.context.peakRssBytes, ...result.discovery.units.map(u => u.peakRssBytes), ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const conditions = d2e.d2eRegisteredConditions()
  const k2 = validation.k2, i0 = validation.i0
  const refRow = r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
    generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntry: { file: `${r.runDir}/${r.file}`, bytes: r.bytes, sha256: r.sha256 }, requiresSupport: [...r.requiresSupport], searchIdentity: r.searchIdentity,
    keySha256: r.keySha256 })
  const output = {
    phase: d2e.D2E_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d2e.D2E_SPEC_FILE, sha256: specDocumentSha256 },
      d2d: { result: src('d2dResult'), attestation: src('d2dAttestation'), raw: src('d2dRaw'), documents: { d2dA: src('d2dSpecDocument'), d2dB: src('d2dbDocument') } },
      d2c: { result: src('d2cResult'), attestation: src('d2cAttestation'), raw: src('d2cRaw'), contextRecordsUsed: contextSources },
      d2: { result: src('d2Result') },
      incumbentGeneratedEntries: gStoreSources,
      phase2c2Result: { file: d2e.D2E_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      documents: { d2cA: documentSources.d2cA, d2cB: documentSources.d2cB, d2a: documentSources.d2a, d2b: documentSources.d2b, d1a: documentSources.d1a, phaseA: documentSources.phaseA,
        phaseB: documentSources.phaseB, followup: documentSources.followup, d1b: documentSources.d1b },
      d2e: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, rvRecord: rvRecordSource, contextRecord: contextRecordSource,
        discoveryRecords: discoverySources, generatedEntries: generatedEntrySources, records },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      d2dMeasuredHead: d2e.D2E_D2D_PROVENANCE.measuredHead, d2cMeasuredHead: d2e.D2E_D2C_PROVENANCE.measuredHead, d2MeasuredHead: d2e.D2E_D2_PROVENANCE.measuredHead,
      ...d2e.D2E_PROVENANCE_FLAGS,
      d2dResultFieldsRead: [...d2e.D2E_D2D_RESULT_ALLOWLIST], d2cResultFieldsRead: [...d2e.D2E_D2C_RESULT_ALLOWLIST], d2ResultFieldsRead: [...d2e.D2E_D2_RESULT_ALLOWLIST],
      contextRecordFieldsRead: [...d2e.D2E_CONTEXT_RECORD_FIELDS_READ],
      d2dResultModified: observed.d2dResult?.sha256 !== d2e.D2E_REGISTERED_INPUTS.d2dResult.sha256,
      d2cResultModified: observed.d2cResult?.sha256 !== d2e.D2E_REGISTERED_INPUTS.d2cResult.sha256,
      d2ResultModified: observed.d2Result?.sha256 !== d2e.D2E_REGISTERED_INPUTS.d2Result.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: attestation.rngEngineVersion, calculationContext: attestation.observedCalculationContext },
    conditions: {
      k2Context: k2 === null ? null : { contextId: k2.contextId, label: k2.label, targetWeaponId: k2.targetWeaponId, currentBuildListEntryId: k2.currentBuildListEntryId,
        supportBuildListEntryIds: k2.supportBuildListEntryIds, supportTargetWeaponIds: k2.supportTargetWeaponIds, k1Contexts: k2.k1Contexts },
      derivationRule: conditions.derivationRule,
      registeredReservation: { reservationDigest: d2e.D2E_K2_RESERVATION_DIGEST, reservationBody: validation.registeredReservationBody, originDigest: d2e.D2E_ORIGIN_DIGEST },
      ladder: conditions.ladder, k2PoolCap: conditions.k2PoolCap, dedupRules: conditions.dedupRules, deliveryCapPerUnit: conditions.deliveryCapPerUnit,
      incumbent: (i0?.replacements ?? []).map(refRow), order: conditions.order, i0Rule: conditions.i0Rule, admissionRule: conditions.admissionRule, extensionRule: conditions.extensionRule,
      r5Definition: conditions.r5Definition, extensionDiagnostics: conditions.extensionDiagnostics, gate: conditions.gate, betterRule: conditions.betterRule, improvedRule: conditions.improvedRule,
      selectionOrder: conditions.selectionOrder, r6Definition: conditions.r6Definition, rvChecks: conditions.rvChecks, contextChecks: conditions.contextChecks, supportChecks: conditions.supportChecks,
      supportExpiryCauses: conditions.supportExpiryCauses, budgets: conditions.budgets, executionEnvelope: conditions.executionEnvelope, researchMaxPlanSteps: conditions.researchMaxPlanSteps,
      evaluationFullRunCap: conditions.evaluationFullRunCap, decisionRule: conditions.decisionRule, comparisonBaselines: conditions.comparisonBaselines, notRun: conditions.notRun,
      contextRule: conditions.contextRule, discoveryRule: conditions.discoveryRule,
      evaluationProcedure: 'runD2EEvaluation(): the runD2Evaluation() procedure (B0 persisted; otherwise O_t -> G store bodies, the replacement preflight with no fixed constraint, one full runner with a fresh budget of 8; ADM found_R with explicit decision = fixed Route = support = S) with the §7.2 static checks: S4 / S5 per support against its S5 authority (lowest-k) CTX record, each K1 replacement against its own CTX record, S6 for the K2 Candidate; the D2-C / D2 evaluation refuses a two-support replacement (§14.2 wrapper)',
      supportAuthorityRule: 'S5 authority: the lowest-k K1 CTX record of each support (CTX-6 / CTX-3 / CTX-1 in support Entry ID order); V proves every other CTX record of the same support equal',
      equalMetricsRule: 'equalMetrics / conflictIncreased are recorded for eligible EXT only (they explain why an eligible EXT is not improved); false otherwise',
      priorDeterminismScope: 'the D2-D (8), D2-C (26) and D2 (86) evaluations, by inputDigest; registered matches: B0 and I0 only',
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)' },
    inputValidation: { passed: validation.passed, issues: validation.issues,
      derivedK2Contexts: (validation.k2Derivation?.contexts ?? []).map(c => ({ targetWeaponId: c.targetWeaponId, currentBuildListEntryId: c.currentBuildListEntryId, supportBuildListEntryIds: c.supportBuildListEntryIds,
        admObserved: c.admObserved, cmpObserved: c.cmpObserved, crossSupportLossAll: c.crossSupportLossAll })),
      derivedI0: i0 === null ? null : { generatedBuildListEntryIds: i0.generatedBuildListEntryIds, generatedEntrySha256s: i0.generatedEntrySha256s, requiresSupport: i0.requiresSupport, inputDigest: i0.inputDigest },
      d2cT03ResourceIdentities: validation.d2cT03ResourceIdentities, d2bK0Pool: validation.d2bK0Pool, d2cK1Pool: validation.d2cK1Pool },
    rv: result.rv,
    context: result.context,
    discovery: result.discovery,
    evaluations: evals,
    parityChecks: result.parityChecks,
    extensions: result.extensions,
    comparison: result.comparison,
    aggregates: { ...result.aggregates,
      timing: { rvWallMs: result.rv.wallMs, contextWallMs: result.context.wallMs, discoveryWallMs: sum(result.discovery.units.map(u => u.wallMs ?? 0)), evaluationWallMs: sum(evals.map(e => e.wallMs ?? 0)),
        runWallMs: raw?.wallMs ?? null, discoveryEnvelopeReached: raw?.discoveryEnvelopeReached === true, runEnvelopeReached: raw?.runEnvelopeReached === true },
      memory: { peakHeapBytes: maxOf(heaps), peakRssBytes: maxOf(rss) } },
    invalidReasons: result.invalidReasons,
    decision: result.decision,
  }
  if (!formal && !allowNonformal) throw new Error(`Not a formal run (${provenanceIssues.join('; ')}); pass --allow-nonformal for a smoke analysis.`)
  await writeFile(paths.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, runStatus, decision: output.decision.case, rv: `${result.rv.status}/${result.rv.satisfied}`, context: result.context.status,
    discovery: result.discovery.units.map(u => `${u.unitId}:${u.status}`), outcome: result.discovery.outcome, pool: result.discovery.pool.length,
    evaluations: evals.map(e => `${e.evaluationId}:${e.status}${e.plan ? ` ${e.plan.termination?.completedTargetCount}/${e.conflicts.length}/${e.plan.steps} r5=${e.r5.satisfied} el=${e.eligible} imp=${e.improved}` : ''}`),
    best: output.extensions.bestEligibleExtension, bestImproved: output.extensions.bestImprovedExtension, invalid: output.invalidReasons.length, invalidReasons: output.invalidReasons.slice(0, 20) }, null, 2))
} finally {
  await server.close()
}
