import { beforeAll, describe, expect, it } from 'vitest'
import {
  collectD1cRecordIdentifiers, D1C_PUBLIC_RESULT_FORBIDDEN_KEYS, D1C_PUBLIC_RESULT_KIND, D1cPublicResultSourceError, d1cPublicResultIssues, d1cPublicResultMinimizationIssues,
  deriveD1cPublicResult, rebuildD1cObservation,
} from './verificationFormalResult'
import { concludeD1cMeasurement } from './verificationFormal'
import { d1cFixture, type D1cFixture, type D1cFixtureParts } from './verificationFormalTestFixture'

/*
 * Issue #154 Global Assignment Phase D-1C (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md): the public RESULT is the mechanical
 * aggregate of the raw outputs. The derivation rebuilds the observations from the raw records, re-derives the whole conclusion and refuses
 * any raw RESULT whose recorded conclusion, start record, readings or semantic hashes are not the records' own; the published file carries
 * no Target / Entry / OwnedWeapon identifier, Entry body, Route, Counter position or Plan Step.
 */
let fixture: D1cFixture
beforeAll(async () => { fixture = await d1cFixture() }, 120_000)
const sourcesOf = (edit: (parts: D1cFixtureParts) => void = () => {}) => { const parts = fixture.parts(); edit(parts); return fixture.sources(parts) }

describe('Phase D-1C public RESULT', () => {
  it('derives a minimized RESULT whose conclusion is re-derived from the raw records', () => {
    const sources = sourcesOf()
    const published = deriveD1cPublicResult(sources, fixture.expectation)
    expect(d1cPublicResultIssues(published, sources, fixture.expectation)).toEqual([])
    expect(published.resultKind).toBe(D1C_PUBLIC_RESULT_KIND)
    expect(published.derivation.consistency).toEqual({ startRecordMatchesRaw: true, readingsMatchRaw: true, semanticSha256MatchesRecords: true, conclusionMatchesRecords: true })
    expect(published.formalValidity.status).toBe('valid')
    expect(published.candidateOutcome).toMatchObject({ kind: 'verified', consistentAcrossRuns: true, verdict: { kind: 'verified', physicalOperations: 5, planSteps: 5, objective: 5, fullPlannerRuns: { first: 1, fresh: 1 } } })
    expect(published.acceptance).toEqual({ status: 'accepted', formalValidity: 'valid', candidateOutcome: 'verified', reasonTexts: [] })
    expect(published.determinism).toMatchObject({ materializationIdentical: true, verificationIdentical: true, entryFingerprintIdentical: true })
    expect(published.determinism.verificationSemanticSha256s).toHaveLength(4)
    expect(published.plannerIntegration).toMatchObject({ planningTargetCount: 2, selectedEntryCount: 2, conflictCount: 0, rejectedCount: 0, warningCount: 0, traceReplayValid: true, planSteps: 5, physicalOperations: 5, nonPhysicalStepCount: 0, streamAdvanceSum: 5, objective: 5, fullPlannerRuns: [1, 1, 1, 1] })
    expect(published.runs.map(run => [run.first.process.outcome, run.fresh!.process.outcome, run.first.formal!.gatePassed, run.fresh!.formal!.entrySetSourcePassed, run.conclusion.verdict!.kind])).toEqual([
      ['completed', 'completed', true, true, 'verified'], ['completed', 'completed', true, true, 'verified'],
    ])
    expect(published.postHoc.minimality).toMatchObject({ status: 'best_found', provenMinimum: false })
    // Deterministic: the same raw sources give the same JSON.
    expect(JSON.stringify(deriveD1cPublicResult(sourcesOf(), fixture.expectation))).toBe(JSON.stringify(published))
  })

  it('carries no record identifier, Entry body, Route, Counter position or Plan Step', () => {
    const sources = sourcesOf()
    const identifiers = collectD1cRecordIdentifiers(sources.children)
    const parts = fixture.parts()
    const record = parts.runs[0]!.first.record!
    // The collected identifiers cover the planning Targets, the generated and original Entries and the materialization order.
    for (const id of [...record.phase0PlanningTargetIds, ...record.verification.semantic.planner.selectedBuildListEntryIds, ...record.verification.semantic.finalInput.keptOriginalEntryIds]) expect(identifiers).toContain(id)
    expect(identifiers.length).toBeGreaterThan(4)
    const published = deriveD1cPublicResult(sources, fixture.expectation)
    expect(d1cPublicResultMinimizationIssues(published, identifiers)).toEqual([])
    const text = JSON.stringify(published)
    for (const id of identifiers) expect(text).not.toContain(id)
    for (const key of ['candidateSnapshot', 'materializedEntries', 'phase0PlanningTargetIds', 'selectedBuildListEntryIds', 'streams', 'finalCounters', 'steps', 'streamEnd', 'origins']) expect(text).not.toContain(`"${key}":`)
    // Injected leaks are refused by name.
    const leaked = structuredClone(published) as Record<string, unknown>
    leaked.extra = { targetWeaponId: record.phase0PlanningTargetIds[0], list: [1, 2], path: 'C:\\Users\\x', uuid: '01234567-89ab-cdef-0123-456789abcdef' }
    const issues = d1cPublicResultMinimizationIssues(leaked, identifiers)
    expect(issues).toEqual(expect.arrayContaining([
      '$.extra.targetWeaponId is a Target-level or Plan-level field.', '$.extra.list is not a known aggregate array.', 'The public RESULT contains a UUID.',
      'The public RESULT contains a local absolute path.', expect.stringMatching(/^The public RESULT contains a record identifier/),
    ]))
    expect(D1C_PUBLIC_RESULT_FORBIDDEN_KEYS).toEqual(expect.arrayContaining(['targetWeaponId', 'entry', 'candidateSnapshot', 'steps', 'streams', 'replacements', 'stderrTail', 'pid']))
  })

  it('refuses a published RESULT that is not the re-derivation, and raw sources whose conclusion, start record, readings or hashes disagree', () => {
    const sources = sourcesOf()
    const published = deriveD1cPublicResult(sources, fixture.expectation)
    const edited = structuredClone(published)
    edited.acceptance.status = 'not_accepted'
    expect(d1cPublicResultIssues(edited, sources, fixture.expectation)).toEqual(['The public RESULT is not the re-derivation of the raw sources (differing: acceptance).'])
    // The runner's recorded conclusion is not the one the records give.
    const forged = sourcesOf()
    forged.output.conclusion = { ...forged.output.conclusion, acceptance: { ...forged.output.conclusion.acceptance, status: 'accepted' }, formalValidity: { ...forged.output.conclusion.formalValidity, status: 'valid' } }
    const invalid = sourcesOf(parts => { parts.runs[1]!.fresh!.record!.verification.semantic.planner.planHash = 'fnv1a32:00000000'; parts.runs[1]!.fresh!.record!.verification.semanticSha256 = fixture.hash(JSON.stringify(parts.runs[1]!.fresh!.record!.verification.semantic)) })
    invalid.output.conclusion = forged.output.conclusion
    expect(d1cPublicResultIssues(deriveD1cPublicResult(invalid, fixture.expectation), invalid, fixture.expectation)).toContain('The conclusion re-derived from the raw records is not the runner\'s.')
    // A start record that is not the raw provenance.
    const start = sourcesOf()
    start.startRecordText = '{}\n'
    expect(d1cPublicResultIssues(deriveD1cPublicResult(start, fixture.expectation), start, fixture.expectation)).toEqual(expect.arrayContaining(['The start record in the run directory is not the start provenance of the raw RESULT.']))
    // A reading the runner recorded that the files do not reproduce.
    const reading = sourcesOf()
    reading.output.runs[0]!.fresh!.recomputed = { ...reading.output.runs[0]!.fresh!.recomputed, verificationSha256: '0'.repeat(64) }
    expect(d1cPublicResultIssues(deriveD1cPublicResult(reading, fixture.expectation), reading, fixture.expectation)).toContain('A child record read from the run directory is not the one the runner read.')
    // A recorded semantic SHA-256 that is not its record's hash (an integrity failure the conclusion also carries).
    const hashes = sourcesOf(parts => { parts.runs[0]!.first.record!.verification.semanticSha256 = 'f'.repeat(64) })
    const derived = deriveD1cPublicResult(hashes, fixture.expectation)
    expect(d1cPublicResultIssues(derived, hashes, fixture.expectation)).toEqual(['A recorded semantic SHA-256 is not the hash of its record.'])
    expect(derived.formalValidity.status).toBe('invalid')
    expect(derived.candidateOutcome.kind).toBe('invalid_run_integrity')
    expect(derived.acceptance.status).toBe('not_accepted')
  })

  it('publishes an invalid or rejected measurement as such, with the integrity messages redacted', () => {
    const sources = sourcesOf(parts => { parts.runs[0]!.fresh!.record!.repositoryHeadSha = 'b'.repeat(40) })
    const published = deriveD1cPublicResult(sources, fixture.expectation)
    expect(d1cPublicResultIssues(published, sources, fixture.expectation)).toEqual([])
    expect(published.formalValidity.status).toBe('invalid')
    expect(published.integrityIssues.resultCount).toBeGreaterThan(0)
    expect(published.integrityIssues.runCounts[0]).toBeGreaterThan(0)
    expect(published.postHoc.operationCount.judgement).toBe('not_evaluated')
    // An unreadable fresh record is an integrity failure, never "no record".
    const unreadable = sourcesOf(parts => { parts.runs[1]!.fresh!.readError = 'record unreadable: Unexpected end of JSON input' })
    const derived = deriveD1cPublicResult(unreadable, fixture.expectation)
    expect(d1cPublicResultIssues(derived, unreadable, fixture.expectation)).toEqual([])
    expect(derived.runs[1]!.fresh!.recordReadError).toBe('unreadable')
    expect(derived.candidateOutcome.kind).toBe('invalid_run_integrity')
  })

  it('refuses raw sources of another kind or without a reading for a recorded child', () => {
    const sources = sourcesOf()
    expect(() => rebuildD1cObservation({ ...sources, output: { ...sources.output, resultKind: 'global-assignment-d1a-result' } })).toThrow(D1cPublicResultSourceError)
    expect(() => rebuildD1cObservation({ ...sources, children: sources.children.slice(1) })).toThrow('No reading was given for run 1 first.')
    const observation = rebuildD1cObservation(sources)
    expect(JSON.stringify(concludeD1cMeasurement(observation, fixture.expectation))).toBe(JSON.stringify(sources.output.conclusion))
  })
})
