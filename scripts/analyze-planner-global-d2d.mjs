// Issue #154 D2-D-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of run-planner-global-d2d.mjs (start
// attestation, rv.jsonl, evaluations.jsonl, the RV / evaluation records; the raw output when it exists), the registered inputs again
// (re-validated with validateD2DInputs(); the D2-C / D2 RESULTs through the D2-D allowlists only, the CTX records through
// projectD2DContextRecord()), the 12 G store bodies and the Export, and writes docs/PLANNER_GLOBAL_D2D_RESULT.json. Every judgement
// (RV1 .. RV6, R5, S1 .. S5, R6, pairCoexistence, gate, improved, selection, parity, determinism, evidence integrity, the decision)
// is re-derived from the records by analyzeD2DRun(), never copied from the runner. It reads no oracle file, module or field.
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
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-d2d.mjs --run-dir <run dir> [--run <raw.json.local>] --export <external Export .json> --output <new RESULT .json> [--allow-nonformal]')
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
  const d2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2D.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalD2DAnalysis.ts')
  const research = await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts')

  // ---- the run dir journal (the authority for interrupted runs too)
  const runFile = runPath ? await loadRaw(runPath) : null
  const raw = runFile ? parse(runFile.raw) : null
  const attestationPath = join(paths.runDir, d2d.D2D_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const attestation = attestationFile ? parse(attestationFile.raw) : null
  if (attestation === null) throw new Error('No start attestation: the run has no launch provenance.')
  const journal = file => existsSync(join(paths.runDir, file)) ? lines(readFileSync(join(paths.runDir, file), 'utf8')).map(l => JSON.parse(l)) : []
  const rvRows = journal('rv.jsonl')
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
  const rvRow = rvRows[0] ?? null
  const rvRecord = rvRow === null ? null : await loadRecord('RV', rvRow.process, rvRow.recordFile)
  const rvRecordSource = rvRow?.recordFile ? records.find(r => r.file === rvRow.recordFile.file) ?? null : null
  const evaluationRecords = new Map()
  for (const row of evaluationRows) evaluationRecords.set(row.evaluationId, await loadRecord(row.evaluationId, row.process, row.recordFile))
  const runStatus = raw === null ? 'interrupted' : raw.status
  if (raw !== null) {
    if (!same(raw.rv ?? null, rvRow)) rawConsistency.push('the raw RV row is not rv.jsonl')
    if (!same(raw.evaluations ?? [], evaluationRows)) rawConsistency.push('the raw evaluation rows are not evaluations.jsonl')
    if (raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
  }

  // ---- provenance: only the post-hoc analysis code (and tests / docs) may change after the measured HEAD
  const analysisPaths = ['src/benchmarks/plannerGlobalD2DAnalysis.ts', 'scripts/analyze-planner-global-d2d.mjs']
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
  const specRaw = gitBuffer('show', `${measuredHead}:${d2d.D2D_SPEC_FILE}`)
  const specDocumentSha256 = sha(specRaw)
  const registeredPolicySha256 = d2d.d2dRegisteredPolicySha256(text => sha(text))
  const firstChildStartedAt = [rvRow, ...evaluationRows].map(r => r?.process?.startedAt).filter(Boolean).sort()[0] ?? null

  // ---- the registered inputs, re-validated (V) from the files, the D2-C / D2 RESULTs through the allowlists only
  const readOptional = async path => existsSync(path) ? readFile(path) : null
  const rawExport = await readFile(paths.export)
  const exportJson = JSON.parse(rawExport.toString('utf8'))
  const observed = {}, buffers = {}
  for (const [key, registered] of Object.entries(d2d.D2D_REGISTERED_INPUTS)) {
    const buffer = key === 'export' ? rawExport : await readOptional(registered.file)
    buffers[key] = buffer
    observed[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
  }
  const d2cProjection = d2d.projectD2DD2CResult(parse(buffers.d2cResult))
  const documents = {}, chainedDocuments = {}, documentSources = {}
  for (const key of d2d.D2D_CHAINED_DOCUMENT_KEYS) {
    const ref = d2cProjection?.sources.documents[key] ?? null
    chainedDocuments[key] = ref?.sha256 ?? null
    const buffer = ref === null ? null : await readOptional(ref.file)
    documents[key] = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    documentSources[key] = { file: ref?.file ?? null, bytes: buffer?.length ?? null, sha256: buffer ? sha(buffer) : null }
  }
  const gStoreFiles = {}, gStoreBodies = new Map(), gStoreSources = []
  for (const f of d2d.D2D_G_STORE_FILES) {
    const buffer = await readOptional(join(f.runDir, f.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    gStoreFiles[d2d.d2dGStoreKey(f.label, f.ordinal)] = buffer === null ? null : { file: o, json: parse(buffer) }
    gStoreBodies.set(f.file, buffer === null ? null : { ...o, body: parse(buffer) })
    gStoreSources.push({ origin: f.origin, file: `${f.runDir}/${f.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const contextRecords = {}, contextSources = []
  for (const c of d2d.D2D_CONTEXT_RECORDS) {
    const buffer = await readOptional(join(d2d.D2D_D2C_PROVENANCE.runDir, c.file))
    const o = buffer === null ? null : { bytes: buffer.length, sha256: sha(buffer) }
    contextRecords[c.k] = buffer === null ? null : { file: o, json: parse(buffer) }
    contextSources.push({ file: `${d2d.D2D_D2C_PROVENANCE.runDir}/${c.file}`, bytes: o?.bytes ?? null, sha256: o?.sha256 ?? null })
  }
  const attestationCheck = d2d.verifyD2DStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256, specDocumentSha256, registeredPolicySha256, exportSha256: d2d.d2dChainedExportSha256(parse(buffers.d2cResult)), chainedDocuments, firstChildStartedAt })
  const productionChangedToMeasured = d2d.d2dProductionChangedFiles(lines(git('diff', '--name-only', d2d.D2D_BASE_MAIN, measuredHead)))
  const productionChangedToAnalysis = d2d.d2dProductionChangedFiles(lines(git('diff', '--name-only', d2d.D2D_BASE_MAIN, analysisHead)))
  const provenanceIssues = [...attestationCheck.issues.map(i => `start attestation: ${i}`)]
  if (!measuredHeadIsAncestor) provenanceIssues.push('the measured HEAD is not an ancestor of the analysis HEAD')
  provenanceIssues.push(...calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  provenanceIssues.push(...productionChangedToMeasured.map(p => `Production changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `Production changed before the analysis HEAD: ${p}`))
  if (analysisUncommitted) provenanceIssues.push('uncommitted analysis code')
  if (raw !== null && raw.environment?.repositoryHead !== measuredHead) provenanceIssues.push('the raw environment HEAD is not the attested HEAD')

  const validation = d2d.validateD2DInputs({ files: observed, documents, gStoreFiles, contextRecords, d2cResult: parse(buffers.d2cResult), d2Result: parse(buffers.d2Result),
    phase2c2Result: parse(buffers.phase2c2Result), specMarkdown: specRaw.toString('utf8') })
  if (raw !== null && raw.inputValidation && !same(raw.inputValidation.passed, validation.passed)) rawConsistency.push('the runner V result is not the analyzer V result')
  // RV2, recomputed: the baseline Entries the analyzer builds from the Export independently of the RV child.
  const baselineBuildListEntries = research.globalResearchInputFromExport(exportJson, d2d.D2D_RESEARCH_MAX_PLAN_STEPS).buildListEntries

  const result = analysis.analyzeD2DRun({ validated: validation, exportSha256: observed.export.sha256, exportBuildListEntries: exportJson.buildListEntries, baselineBuildListEntries, gStoreBodies,
    rvRow, rvRecord, evaluationRows, evaluationRecords, interrupted: raw === null, runEnvelopeReached: raw?.runEnvelopeReached === true, abortReason: raw?.abortReason ?? null, provenanceIssues, evidenceIssues,
    rawConsistencyIssues: rawConsistency, childProcessCount: raw === null ? null : raw.processes.length, sha256OfText: text => sha(text) })

  const formal = attestationCheck.verified && measuredHeadIsAncestor && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted && attestation.smoke === null
    && productionChangedToMeasured.length === 0 && productionChangedToAnalysis.length === 0
  const src = key => ({ file: d2d.D2D_REGISTERED_INPUTS[key].file, bytes: observed[key]?.bytes ?? null, sha256: observed[key]?.sha256 ?? null })
  const evals = result.evaluations
  const heaps = [result.rv.peakHeapBytes, ...evals.map(e => e.peakHeapBytes)].filter(v => typeof v === 'number')
  const rss = [result.rv.peakRssBytes, ...evals.map(e => e.peakRssBytes)].filter(v => typeof v === 'number')
  const conditions = d2d.d2dRegisteredConditions()
  const derivation = validation.derivation
  const refRow = r => ({ label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId,
    generatedBuildListEntryId: r.generatedBuildListEntryId, generatedEntry: { file: `${r.runDir}/${r.file}`, bytes: r.bytes, sha256: r.sha256 }, requiresSupport: [...r.requiresSupport], searchIdentity: r.searchIdentity,
    keySha256: r.keySha256 })
  const output = {
    phase: d2d.D2D_RESULT_PHASE,
    analyzedAt: new Date().toISOString(),
    sources: {
      specDocument: { file: d2d.D2D_SPEC_FILE, sha256: specDocumentSha256 },
      d2c: { result: src('d2cResult'), attestation: src('d2cAttestation'), raw: src('d2cRaw'), specDocument: src('d2cSpecDocument'), d2cbDocument: src('d2cbDocument'),
        generatedEntriesUsed: gStoreSources.filter(g => g.origin === 'd2c_k1').map(({ origin, ...g }) => g), contextRecordsUsed: contextSources },
      d2: { result: src('d2Result'), generatedEntriesUsed: gStoreSources.filter(g => g.origin === 'd2b_k0').map(({ origin, ...g }) => g) },
      phase2c2Result: { file: d2d.D2D_REGISTERED_INPUTS.phase2c2Result.file, sha256: observed.phase2c2Result?.sha256 ?? null },
      export: { file: basename(paths.export), bytes: rawExport.length, sha256: observed.export.sha256, committed: false },
      documents: { d2cA: src('d2cSpecDocument'), d2cB: src('d2cbDocument'), d2a: documentSources.d2a, d2b: documentSources.d2b, d1a: documentSources.d1a, phaseA: documentSources.phaseA,
        phaseB: documentSources.phaseB, followup: documentSources.followup, d1b: documentSources.d1b },
      d2d: { raw: runFile?.source ?? null, runDir: basename(resolve(paths.runDir)), attestation: attestationFile.source, rvRecord: rvRecordSource, records },
    },
    provenance: {
      formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis },
      startAttestation: { sha256: attestationFile.source.sha256, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      d2cMeasuredHead: d2d.D2D_D2C_PROVENANCE.measuredHead, d2MeasuredHead: d2d.D2D_D2_PROVENANCE.measuredHead,
      ...d2d.D2D_PROVENANCE_FLAGS,
      d2cResultFieldsRead: [...d2d.D2D_D2C_RESULT_ALLOWLIST], d2ResultFieldsRead: [...d2d.D2D_D2_RESULT_ALLOWLIST], contextRecordFieldsRead: [...d2d.D2D_CONTEXT_RECORD_FIELDS_READ],
      d2cResultModified: observed.d2cResult?.sha256 !== d2d.D2D_REGISTERED_INPUTS.d2cResult.sha256,
      d2ResultModified: observed.d2Result?.sha256 !== d2d.D2D_REGISTERED_INPUTS.d2Result.sha256,
    },
    environment: raw?.environment ?? { note: 'interrupted run: no raw environment', node: attestation.node, machine: attestation.machine, appliedExecutionEnvelope: attestation.appliedExecutionEnvelope,
      rngEngineVersion: attestation.rngEngineVersion, calculationContext: attestation.observedCalculationContext },
    conditions: {
      fixedCandidates: (derivation?.fixed ?? []).map(refRow), t07Candidates: (derivation?.p07 ?? []).map(refRow), t05Candidates: (derivation?.p05 ?? []).map(refRow),
      pairs: (derivation?.pairs ?? []).map(p => ({ pairOrdinal: p.pairOrdinal, evaluationId: p.evaluationId, t05Ordinal: p.t05Ordinal, t07Ordinal: p.t07Ordinal, generatedBuildListEntryIds: p.generatedBuildListEntryIds,
        requiresSupport: p.requiresSupport, inputDigest: p.inputDigest, registeredInputDigest: p.registeredInputDigest })),
      derivationRule: conditions.derivationRule, order: conditions.order, i0Rule: conditions.i0Rule, pairRule: conditions.pairRule, r5Definition: conditions.r5Definition,
      pairCoexistenceDefinition: conditions.pairCoexistenceDefinition, gate: conditions.gate, betterRule: conditions.betterRule, improvedRule: conditions.improvedRule, selectionOrder: conditions.selectionOrder,
      r6Definition: conditions.r6Definition, rvChecks: conditions.rvChecks, supportChecks: conditions.supportChecks, supportExpiryCauses: conditions.supportExpiryCauses, budgets: conditions.budgets,
      executionEnvelope: conditions.executionEnvelope, researchMaxPlanSteps: conditions.researchMaxPlanSteps, evaluationFullRunCap: conditions.evaluationFullRunCap, decisionRule: conditions.decisionRule,
      comparisonBaselines: conditions.comparisonBaselines, notRun: conditions.notRun,
      runnerStage: 'B0 runs runD2CEvaluation() stage B0 (persisted); I0 and PAIR run the D2-C I0 procedure (stage Z0 of runD2Evaluation(): replacement_set, no found_R); the RESULT records the stage as B0 / I0 / PAIR',
      supportContextRule: 'each K1 replacement carries its own CTX record (t00 CTX-1, t04 CTX-5, t05 CTX-6, t10 CTX-7) to runD2CEvaluation(); the analyzer judges S4 / S5 against the lowest-k CTX record of the support (e396d352: CTX-1), which RV / V prove equal to every other CTX record of the same support',
      equalMetricsRule: 'equalMetrics / conflictIncreased are recorded for eligible PAIRs only (they explain why an eligible PAIR is not improved); false otherwise',
      priorDeterminismScope: 'the allowlisted D2 (B0, ADM-t07-c1..c3) and D2-C (B0, CMP-t10-c1, CMP-t05-c1/-c2, ADM-t05-c1/-c2) evaluations; §1.8 registers that no PAIR inputDigest occurs among all 86 + 26 prior evaluations',
      runtimeUnsupportedRemovalDerivation: 'the rng_prediction_unsupported warnings of the result that the validation of the run input does not produce, one per retry (fail closed otherwise)' },
    inputValidation: { passed: validation.passed, issues: validation.issues,
      derivedPairs: (derivation?.pairs ?? []).map(p => ({ pairOrdinal: p.pairOrdinal, evaluationId: p.evaluationId, t05Ordinal: p.t05Ordinal, t07Ordinal: p.t07Ordinal, generatedBuildListEntryIds: p.generatedBuildListEntryIds,
        generatedEntrySha256s: p.generatedEntrySha256s, requiresSupport: p.requiresSupport, inputDigest: p.inputDigest })),
      derivedI0: derivation?.i0 ? { generatedBuildListEntryIds: derivation.i0.generatedBuildListEntryIds, generatedEntrySha256s: derivation.i0.generatedEntrySha256s, requiresSupport: derivation.i0.requiresSupport,
        inputDigest: derivation.i0.inputDigest } : null,
      d2cT05ResourceIdentities: validation.d2cT05ResourceIdentities },
    rv: result.rv,
    evaluations: evals,
    parityChecks: result.parityChecks,
    d2cKnownComparison: result.d2cKnownComparison,
    pairs: result.pairs,
    comparison: result.comparison,
    aggregates: { ...result.aggregates,
      timing: { rvWallMs: result.rv.wallMs, evaluationWallMs: sum(evals.map(e => e.wallMs ?? 0)), runWallMs: raw?.wallMs ?? null, runEnvelopeReached: raw?.runEnvelopeReached === true },
      memory: { peakHeapBytes: maxOf(heaps), peakRssBytes: maxOf(rss) } },
    invalidReasons: result.invalidReasons,
    decision: result.decision,
  }
  if (!formal && !allowNonformal) throw new Error(`Not a formal run (${provenanceIssues.join('; ')}); pass --allow-nonformal for a smoke analysis.`)
  await writeFile(paths.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, runStatus, decision: output.decision.case, rv: `${result.rv.status}/${result.rv.satisfied}`,
    evaluations: evals.map(e => `${e.evaluationId}:${e.status}${e.plan ? ` ${e.plan.termination?.completedTargetCount}/${e.conflicts.length}/${e.plan.steps} r5=${e.r5.satisfied} pc=${e.pair?.pairCoexistence ?? '-'} el=${e.eligible} imp=${e.improved}` : ''}`),
    best: output.pairs.bestEligiblePair, bestImproved: output.pairs.bestImprovedPair, invalid: output.invalidReasons.length, invalidReasons: output.invalidReasons.slice(0, 20) }, null, 2))
} finally {
  await server.close()
}
