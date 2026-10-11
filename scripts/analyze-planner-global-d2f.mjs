// Issue #154 D2-F-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d2f.mjs (start
// attestation, rv.jsonl, contexts.jsonl, discovery.jsonl, evaluations.jsonl, the RV / CTX-K3 / DSC / evaluation records, the K3 G
// store; the raw output when it exists), the registered inputs again (re-validated with validateD2FInputs(); the D2-E / D2-D / D2-C /
// D2 RESULTs through the D2-F allowlists only, the K1 CTX records through readD2EContextRecord(), the D2-E CTX-K2 record through
// readD2FK2ContextRecord()), the 9 incumbent G store bodies, the D2-E K2 c2 G store body and the Export, and writes
// docs/PLANNER_GLOBAL_D2F_RESULT.json. Every judgement (RV1 .. RV8, C1 .. C8, the rung progression, D-1 .. D-6, R0-K3 / R0-K2 /
// R0-split, R1, S1 .. S6, R5, the EXT diagnostics, gate, improved, R6, parity, determinism, evidence integrity, the decision) is
// re-derived from the records and the Export by analyzeD2FRun(), never copied from the runner. It reads no oracle file, module or field.
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
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d2f.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
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
  const d2f = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2F.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2FAnalysis.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const searchOrigin = await server.ssrLoadModule('/src/domain/planner/replacement/plannerSearchOrigin.ts')
  const hashing = await server.ssrLoadModule('/src/domain/models/hashing.ts')
  const ProductionRngEngine = (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d2f.D2F_START_ATTESTATION_FILE)
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
  if (contextRows.length > 1) evidenceIssues.push(`${contextRows.length} CTX-K3 rows, not at most 1`)
  const rvRow = rvRows[0] ?? null
  const rvRecord = rvRow === null ? null : await loadRecord('RV', rvRow.process, rvRow.recordFile)
  const rvRecordSource = rvRow?.recordFile ? records.find(r => r.file === rvRow.recordFile.file) ?? null : null
  const contextRow = contextRows[0] ?? null
  const contextRecord = contextRow === null ? null : await loadRecord('CTX-K3', contextRow.process, contextRow.recordFile)
  const contextRecordSource = contextRow?.recordFile ? records.find(r => r.file === contextRow.recordFile.file) ?? null : null
  const discoveryRecords = new Map()
  for (const row of discoveryRows) discoveryRecords.set(row.unitId, await loadRecord(row.unitId, row.process, row.recordFile))
  const discoverySources = discoveryRows.filter(r => r.recordFile).map(r => records.find(x => x.file === r.recordFile.file)).filter(Boolean)
  const evaluationRecords = new Map()
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.process, row.recordFile))
  // The K3 G store files the children wrote (read back by name; the analysis checks them against the records).
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
    if (!same(raw.context ?? null, contextRow)) rawConsistency.push('the raw CTX-K3 row is not contexts.jsonl')
    if (!same(raw.discovery ?? [], discoveryRows)) rawConsistency.push('the raw discovery rows are not discovery.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD2FAnalysis.ts', 'scripts/analyze-planner-global-d2f.mjs']
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
  const specRaw = gitBuffer('show', `${measuredHead}:${d2f.D2F_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const registeredPolicySha256 = d2f.d2fRegisteredPolicySha256(text => sha(text))
  const firstChildStartedAt = [rvRow, contextRow, ...discoveryRows, ...evaluationRows].map(r => r?.process?.startedAt).filter(Boolean).sort()[0] ?? null

  // ---- the registered inputs, re-validated (V) from the files, the RESULTs through the allowlists only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2f.D2F_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const conditions = d2f.d2fRegisteredConditions()
  const d2eProjection = d2f.projectD2FD2EResult(parse(buffers.d2eResult))
  const documents = {}, chainedDocuments = {}, documentSources = {}
  for (const key of conditions.chainedDocuments) {
    const ref = d2eProjection?.sources.documents[key] ?? null
    chainedDocuments[key] = ref?.sha256 ?? null
    const buffer = ref === null ? null : await readOptional(ref.file)
    documents[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    documentSources[key] = { file: ref?.file ?? null, bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null }
  }
  const gStoreFiles = {}, incumbentBodies = new Map(), gStoreSources = []
  for (const f of conditions.gStoreFiles) {
    const buffer = await readOptional(join(f.runDir, f.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    gStoreFiles[`${f.label}-c${f.ordinal}`] = buffer === null ? null : { file: o, json: parse(buffer) }
    incumbentBodies.set(f.file, buffer === null ? null : { ...o, body: parse(buffer) })
    gStoreSources.push({ file: `${f.runDir}/${f.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const contextRecords = {}, contextSources = []
  for (const c of conditions.contextRecords) {
    const buffer = await readOptional(join(conditions.d2cProvenance.runDir, c.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    contextRecords[c.k] = buffer === null ? null : { file: o, json: parse(buffer) }
    contextSources.push({ file: `${conditions.d2cProvenance.runDir}/${c.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const attestationCheck = d2f.verifyD2FStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: d2f.d2fChainedExportSha256(parse(buffers.d2eResult)), chainedDocuments, firstChildStartedAt })
  const productionChangedToMeasured = d2f.d2fProductionChangedFiles(lines(git('diff', '--name-only', d2f.D2F_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d2f.d2fProductionChangedFiles(lines(git('diff', '--name-only', d2f.D2F_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  const validation = d2f.validateD2FInputs({ files: observed, documents, gStoreFiles, contextRecords, d2eContextRecord: parse(buffers.d2eContextRecord), d2eWpGeneratedEntry: parse(buffers.d2eWpGeneratedEntry),
    d2eResult: parse(buffers.d2eResult), d2dResult: parse(buffers.d2dResult), d2cResult: parse(buffers.d2cResult), d2Result: parse(buffers.d2Result), phase2c2Result: parse(buffers.phase2c2Result),
    exportBuildListEntries: exportJson.buildListEntries, specMarkdown: specRaw.toString('utf8'), d2eSpecMarkdown: buffers.d2eSpecDocument === null ? '' : buffers.d2eSpecDocument.toString('utf8'), sha256OfText: text => sha(text) })
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')
  // RV2 / RV8 / C4 / R0, recomputed: the baseline PlannerInput and the Planner-start origin the analyzer builds from the Export independently of the children.
  const baselineInput = research.globalResearchInputFromExport(exportJson, d2f.D2F_RESEARCH_MAX_PLAN_STEPS)
  const recomputedOriginDigest = hashing.hashStableValue(searchOrigin.createPlannerStartSearchOrigin(baselineInput))
  // C3 / C5 / C7 / C8 / RV7 / R0, recomputed with the registered Production RNG Engine the analyzer instantiates itself.
  const rngEngine = new ProductionRngEngine()
  if (rngEngine.version !== d2f.D2F_RNG_ENGINE_VERSION) throw new Error('PRODUCTION_RNG_ENGINE_VERSION moved: the analyzer cannot recompute with the registered Engine.')
  const d2cContexts = d2f.projectD2FD2CResult(parse(buffers.d2cResult), validation.k3?.label ?? null)?.contexts ?? []
  const wpBody = buffers.d2eWpGeneratedEntry === null ? null : { bytes: buffers.d2eWpGeneratedEntry.length, sha256: sha(buffers.d2eWpGeneratedEntry), body: parse(buffers.d2eWpGeneratedEntry) }

  const result = analysis.analyzeD2FRun({ validated: validation, exportSha256: observed.export.sha256, exportBuildListEntries: exportJson.buildListEntries, baselineInput, recomputedOriginDigest, d2cContexts,
    rngEngine, incumbentBodies, wpBody, rvRow, rvRecord, contextRow, contextRecord, discoveryRows, discoveryRecords, poolFiles, evaluationRows, evaluationRecords,
    interrupted: raw === null, discoveryEnvelopeReached: raw?.discoveryEnvelopeReached === true, runEnvelopeReached: raw?.runEnvelopeReached === true, abortReason: raw?.abortReason ?? null, provenanceIssues, evidenceIssues,
    rawConsistencyIssues: rawConsistency, childProcessCount: raw === null ? null : raw.processes.length, sha256OfText: text => sha(text) })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = key => ({ file: d2f.D2F_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null })
  const evals = result.evaluations
  const heaps = [result.rv.peakHeapBytes, result.context.peakHeapBytes, ...result.discovery.units.map(u => u.peakHeapBytes), ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [result.rv.peakRssBytes, result.context.peakRssBytes, ...result.discovery.units.map(u => u.peakRssBytes), ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const k3 = validation.k3, i0 = validation.i0, wp = validation.wp
  const refRow = r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
    generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntry: { file: `${r.runDir}/${r.file}`, bytes: r.bytes, sha256: r.sha256 }, requiresSupport: [...r.requiresSupport], searchIdentity: r.searchIdentity,
    keySha256: r.keySha256 })
  const output = {
    phase: d2f.D2F_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d2f.D2F_SPEC_FILE, sha256: specDocumentSha256 },
      d2e: { result: src('d2eResult'), attestation: src('d2eAttestation'), raw: src('d2eRaw'), contextRecord: src('d2eContextRecord'), wpGeneratedEntry: src('d2eWpGeneratedEntry'),
        documents: { d2eA: src('d2eSpecDocument'), d2eB: src('d2ebDocument') } },
      d2d: { result: src('d2dResult'), attestation: src('d2dAttestation'), raw: src('d2dRaw'), documents: { d2dA: src('d2dSpecDocument'), d2dB: src('d2dbDocument') } },
      d2c: { result: src('d2cResult'), attestation: src('d2cAttestation'), raw: src('d2cRaw'), contextRecordsUsed: contextSources },
      d2: { result: src('d2Result') },
      incumbentGeneratedEntries: gStoreSources,
      phase2c2Result: { file: d2f.D2F_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      documents: Object.fromEntries(conditions.chainedDocuments.map(k => [k, documentSources[k]])),
      d2f: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, rvRecord: rvRecordSource, contextRecord: contextRecordSource,
        discoveryRecords: discoverySources, generatedEntries: generatedEntrySources, records },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      d2eMeasuredHead: conditions.d2eProvenance.measuredHead, d2dMeasuredHead: conditions.d2dProvenance.measuredHead, d2cMeasuredHead: conditions.d2cProvenance.measuredHead, d2MeasuredHead: conditions.d2Provenance.measuredHead,
      ...d2f.D2F_PROVENANCE_FLAGS,
      d2eResultFieldsRead: conditions.d2eResultFieldsRead, d2dResultFieldsRead: conditions.d2dResultFieldsRead, d2cResultFieldsRead: conditions.d2cResultFieldsRead, d2ResultFieldsRead: conditions.d2ResultFieldsRead,
      contextRecordFieldsRead: conditions.contextRecordFieldsRead, k2ContextRecordFieldsRead: conditions.k2ContextRecordFieldsRead,
      d2eResultModified: observed.d2eResult?.sha256 !== d2f.D2F_REGISTERED_INPUTS.d2eResult.sha256,
      d2dResultModified: observed.d2dResult?.sha256 !== d2f.D2F_REGISTERED_INPUTS.d2dResult.sha256,
      d2cResultModified: observed.d2cResult?.sha256 !== d2f.D2F_REGISTERED_INPUTS.d2cResult.sha256,
      d2ResultModified: observed.d2Result?.sha256 !== d2f.D2F_REGISTERED_INPUTS.d2Result.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: attestation.rngEngineVersion, calculationContext: attestation.observedCalculationContext },
    conditions: {
      k3Context: k3 === null ? null : { contextId: k3.contextId, label: k3.label, targetWeaponId: k3.targetWeaponId, currentBuildListEntryId: k3.currentBuildListEntryId, k2SupportBuildListEntryIds: k3.k2SupportBuildListEntryIds,
        addedSupportBuildListEntryId: k3.addedSupportBuildListEntryId, supportBuildListEntryIds: k3.supportBuildListEntryIds, supportTargetWeaponIds: k3.supportTargetWeaponIds, k1Contexts: k3.k1Contexts },
      derivationRule: conditions.derivationRule,
      registeredReservation: { reservationDigest: d2f.D2F_K3_RESERVATION_DIGEST, bodySha256: d2f.D2F_K3_RESERVATION_BODY_SHA256, reservationBody: validation.registeredReservationBody, originDigest: conditions.registeredReservation.originDigest },
      registeredNewSupportReservation: { reservationDigest: d2f.D2F_NEW_SUPPORT_RESERVATION_DIGEST, bodySha256: d2f.D2F_NEW_SUPPORT_RESERVATION_BODY_SHA256, reservationBody: validation.registeredNewSupportReservationBody },
      ladder: conditions.ladder, k3PoolCap: conditions.k3PoolCap, dedupRules: conditions.dedupRules, deliveryCapPerUnit: conditions.deliveryCapPerUnit,
      incumbent: (i0?.replacements ?? []).map(refRow), order: conditions.order, i0Rule: conditions.i0Rule, wrapperParityRule: conditions.wrapperParityRule, wpExpected: conditions.wpExpected,
      evaluationProcedure: conditions.evaluationProcedure, admissionRule: conditions.admissionRule, extensionRule: conditions.extensionRule, r5Definition: conditions.r5Definition,
      extensionDiagnostics: conditions.extensionDiagnostics, gate: conditions.gate, betterRule: conditions.betterRule, improvedRule: conditions.improvedRule, selectionOrder: conditions.selectionOrder,
      r6Definition: conditions.r6Definition, rvChecks: conditions.rvChecks, contextChecks: conditions.contextChecks, supportChecks: conditions.supportChecks, supportExpiryCauses: conditions.supportExpiryCauses,
      budgets: conditions.budgets, executionEnvelope: conditions.executionEnvelope, researchMaxPlanSteps: conditions.researchMaxPlanSteps, evaluationFullRunCap: conditions.evaluationFullRunCap,
      decisionRule: conditions.decisionRule, comparisonBaselines: conditions.comparisonBaselines, notRun: conditions.notRun, contextRule: conditions.contextRule, discoveryRule: conditions.discoveryRule,
      supportAuthorityRule: 'S5 authority: the lowest-k K1 CTX record of each I0 support (CTX-6 / CTX-3 / CTX-1 in support Entry ID order; V proves the other CTX records of the same support equal) and, for the new support, the CTX-K3 record singleSupportReservations entry and supportBodySha256s entry (C8 proves it equal to the §4.2 registered body)',
      equalMetricsRule: 'equalMetrics / conflictIncreased are recorded for eligible EXT only (they explain why an eligible EXT is not improved); false otherwise',
      priorDeterminismScope: 'the D2-E (6), D2-D (8), D2-C (26) and D2 (86) evaluations, by inputDigest; registered matches: B0, I0 and WP (D2-E EXT-K2-t03-c2)',
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)' },
    inputValidation: { passed: validation.passed, issues: validation.issues,
      derivedK3Context: k3 === null ? null : { targetWeaponId: k3.targetWeaponId, currentBuildListEntryId: k3.currentBuildListEntryId, k2Supports: k3.k2SupportBuildListEntryIds, extendedEvaluationId: k3.extendedEvaluationId,
        lostTargetWeaponIds: k3.lostTargetWeaponIds, addedSupport: k3.addedSupportBuildListEntryId, supportBuildListEntryIds: k3.supportBuildListEntryIds },
      derivedI0: i0 === null ? null : { generatedBuildListEntryIds: i0.generatedBuildListEntryIds, generatedEntrySha256s: i0.generatedEntrySha256s, requiresSupport: i0.requiresSupport, inputDigest: i0.inputDigest },
      derivedWp: wp === null ? null : { evaluationId: wp.evaluationId, extensionEvaluationId: wp.extensionEvaluationId, generatedBuildListEntryIds: wp.generatedBuildListEntryIds, generatedEntrySha256s: wp.generatedEntrySha256s,
        requiresSupport: wp.requiresSupport, inputDigest: wp.inputDigest },
      newSupport: validation.newSupport, resourceIdentities: validation.resourceIdentities, d2bK0Pool: validation.d2bK0Pool, d2cK1Pool: validation.d2cK1Pool, d2eK2Pool: validation.d2eK2Pool },
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
    wrapperParity: output.decision.wrapperParity, best: output.extensions.bestEligibleExtension, bestImproved: output.extensions.bestImprovedExtension, invalid: output.invalidReasons.length,
    invalidReasons: output.invalidReasons.slice(0, 20) }, null, 2))
} finally {
  await server.close()
}
