import { describe, expect, it } from 'vitest'
import { ShapeConstrainedSearchError } from '../../domain/search/research'
import { productionShapeMaterializationSearchPort } from './materialize'
import {
  collectRecordIdentifiers, D0C_PUBLIC_RESULT_AGGREGATE_ARRAYS, D0C_PUBLIC_RESULT_FORBIDDEN_KEYS, D0cPublicResultSourceError, d0cPublicResultIssues, d0cPublicResultMinimizationIssues,
  deriveD0cPublicResult,
} from './materializationFormalResult'
import { d0cFixtureConditions, d0cFixtureSources } from './materializationFormalTestFixture'
import { OPEN_SHAPE_BUDGET } from './shapeMaterializationTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0C: the public RESULT is a mechanical, deterministic aggregate of the raw formal outputs; it
 * carries no Target / OwnedWeapon / Entry identifier, no Target-level position, no snapshot and no absolute path; a published RESULT
 * that is not the re-derivation of its sources, whose semantic hashes are not its records' or whose outcome is not its records', is
 * refused.
 */

describe('Phase D-0C public RESULT derivation', () => {
  it('derives a deterministic aggregate that passes its own checks and carries no record identifier', async () => {
    const sources = await d0cFixtureSources()
    const derived = deriveD0cPublicResult(sources)
    expect(JSON.stringify(deriveD0cPublicResult(sources))).toBe(JSON.stringify(derived))
    expect(d0cPublicResultIssues(derived, sources)).toEqual([])
    const identifiers = collectRecordIdentifiers(sources.records)
    expect(identifiers).toEqual(expect.arrayContaining(['target.fixture.a', 'target.fixture.c', 'owned.g1']))
    expect(identifiers.some(id => id.startsWith('build-list.'))).toBe(true)
    expect(identifiers.some(id => id.startsWith('research.global-assignment.shape.'))).toBe(true)
    const text = JSON.stringify(derived)
    for (const identifier of identifiers) expect(text).not.toContain(identifier)
    expect(text).not.toMatch(/target\.fixture|owned\.g|fixture\.run"/)
    expect(derived).toMatchObject({
      resultKind: 'global-assignment-d0c-public-result', mode: 'formal', formalValidity: { status: 'valid' },
      derivation: { revision: 1, consistency: { semanticSha256MatchesRecords: true, materializationOutcomeMatchesRecords: true } },
      materializationOutcome: { verdict: 'all_materialized', measuredRuns: 2, consistentAcrossMeasuredRuns: true },
      structuralCandidate: { targetCount: 2 }, materializedEntries: { count: 2 },
      routeVerification: { failed: 0 }, integrityIssues: { count: 0, messages: [] },
    })
    expect(derived.materializedEntries.fingerprint).toMatch(/^fnv1a32:/)
    // The Route checks ran on every shape-constrained materialization; their re-predictions are counted apart from the Search's.
    expect(derived.routeVerification!.checkedAttempts).toBe(derived.searchScale!.shapeConstrained.executed)
    expect(derived.routeVerification!.passed).toBe(derived.routeVerification!.checkedAttempts)
    expect(derived.runs.map(run => run.timing?.targetMs.count)).toEqual([2, 2])
    expect(derived.runs[0]!.memory).toMatchObject({ heapUsedMax: 100, sampleCount: 5, targetSettledHeapUsed: { count: 2 } })
  }, 60_000)

  it('refuses a published RESULT that is not the re-derivation, or whose hashes or outcome do not come from the records', async () => {
    const sources = await d0cFixtureSources()
    const derived = deriveD0cPublicResult(sources)
    const edited = { ...derived, totalWallMs: derived.totalWallMs + 1 }
    expect(d0cPublicResultIssues(edited, sources)).toEqual(['The public RESULT is not the re-derivation of the raw sources (differing: totalWallMs).'])
    const wrongHash = { ...sources, semanticSha256ByRun: { ...sources.semanticSha256ByRun, 'materialize-2': 'f'.repeat(64) } }
    expect(d0cPublicResultIssues(deriveD0cPublicResult(wrongHash), wrongHash)).toEqual(['A measured run\'s recorded semantic SHA-256 is not the hash of its record.'])
    const wrongOutcome = { ...sources, output: { ...sources.output, materializationOutcome: { ...sources.output.materializationOutcome, verdict: 'not_all_materialized' as const } } }
    expect(d0cPublicResultIssues(deriveD0cPublicResult(wrongOutcome), wrongOutcome)).toEqual(['The runner\'s materialization outcome is not the one its records give.'])
    // A measured run without its record is a source error, never a filled-in result.
    expect(() => deriveD0cPublicResult({ ...sources, records: sources.records.slice(0, 1) })).toThrow(D0cPublicResultSourceError)
  }, 60_000)

  it('refuses identifiers, Target-level keys, unknown arrays, UUIDs and local paths', async () => {
    const sources = await d0cFixtureSources()
    const identifiers = collectRecordIdentifiers(sources.records)
    const derived = deriveD0cPublicResult(sources)
    expect(d0cPublicResultMinimizationIssues(derived, identifiers)).toEqual([])
    expect(d0cPublicResultMinimizationIssues({ ...derived, note: 'target.fixture.a' }, identifiers)).toEqual(['The public RESULT contains a record identifier (16 characters).'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, extra: { targetWeaponId: 'x' } }, identifiers)).toEqual(['$.extra.targetWeaponId is a Target-level field.'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, extra: { finalPosition: 3 } }, identifiers)).toEqual(['$.extra.finalPosition is a Target-level field.'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, perTarget: [1, 2] }, identifiers)).toEqual(['$.perTarget is not a known aggregate array.'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, note: '820831d0-edd9-4005-a4a2-c8025cdad2c2' }, identifiers)).toEqual(['The public RESULT contains a UUID.'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, note: 'D:\\GogmaArtianPlanner\\.local\\x' }, identifiers)).toEqual(['The public RESULT contains a local absolute path.'])
    expect(d0cPublicResultMinimizationIssues({ ...derived, note: 'C:/Users/me' }, identifiers)).toHaveLength(1)
    expect(d0cPublicResultMinimizationIssues({ ...derived, note: 'production-rng:c5-e7 HEAD:docs/x.md https://example' }, identifiers)).toEqual([])
    for (const key of ['targets', 'materializationOrder', 'entryId', 'searchIdentity', 'routeShape', 'operations', 'option', 'samples', 'runDir', 'stderrTail']) expect(D0C_PUBLIC_RESULT_FORBIDDEN_KEYS).toContain(key)
    expect(D0C_PUBLIC_RESULT_AGGREGATE_ARRAYS).not.toContain('targets')
  }, 60_000)

  it('keeps an unmeasured run, a budget stop and a fail-closed stop in the RESULT without inferring an outcome or leaking an identifier', async () => {
    const timedOut = await d0cFixtureSources({ secondTimedOut: true })
    const partial = deriveD0cPublicResult(timedOut)
    expect(d0cPublicResultIssues(partial, timedOut)).toEqual([])
    expect(partial.formalValidity.status).toBe('invalid')
    expect(partial.runs[1]).toMatchObject({ status: 'unmeasured', reason: 'timeout', timing: null, confirmedProgress: { readable: true, settledTargets: 0, targetInProgressWithoutOutcome: true } })
    expect(JSON.stringify(partial)).not.toMatch(/target\.fixture/)

    const budget = await d0cFixtureSources({ conditions: d0cFixtureConditions({ shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxSettledWork: 0 } }) })
    const stopped = deriveD0cPublicResult(budget)
    expect(d0cPublicResultIssues(stopped, budget)).toEqual([])
    expect(stopped.formalValidity.status).toBe('valid')
    expect(stopped.materializationOutcome).toMatchObject({ verdict: 'not_all_materialized', candidates: [{ classification: 'unconfirmed_shape_search_budget', independentStops: { shapeSearchBudget: 1 } }] })
    expect(stopped.searchScale!.shapeConstrained.stops).toEqual({ budget: 1 })

    const failing = await d0cFixtureSources({ execution: { shapeSearch: { ...productionShapeMaterializationSearchPort, visitShapeConstrainedRouteCandidates: async () => { throw new ShapeConstrainedSearchError('shape_search_contract_violation', 'broken') } } } })
    const failed = deriveD0cPublicResult(failing)
    expect(d0cPublicResultIssues(failed, failing)).toEqual([])
    expect(failed.formalValidity.status).toBe('invalid')
    expect(failed.materializationOutcome).toMatchObject({ verdict: 'run_error', candidates: [{ failClosedCode: 'shape_search_contract_violation' }] })
    // The fail-closed integrity issue names its Target in the raw RESULT; the public one keeps the message with the identifier redacted.
    expect(failing.output.integrityIssues.some(issue => issue.includes('target.fixture.a'))).toBe(true)
    expect(failed.integrityIssues.count).toBe(2)
    expect(failed.integrityIssues.messages.every(message => message.includes('<redacted>') && !message.includes('target.fixture'))).toBe(true)
  }, 60_000)
})
