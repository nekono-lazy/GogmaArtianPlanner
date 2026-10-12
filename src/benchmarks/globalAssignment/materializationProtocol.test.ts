import { describe, expect, it } from 'vitest'
import {
  classifyMaterializationStage, MATERIALIZATION_D0B_SMOKE_DEFAULTS, MATERIALIZATION_D0B2_REGISTRATION_ITEMS, materializationFollowUp, materializationFormalRunIssues,
  MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES, parseProgressJournal, smokeDefaults, validateMaterializationEnvelope, validateMaterializationResearchConditions,
  type CandidateMaterializationClass, type ProgressJournalLine,
} from './materializationProtocol'
import type { MaterializationStageOutcome } from './materializationTypes'
import { reachWindowW0 } from './reachTable'
import type { TargetWeaponId } from '../../domain/models/publicTypes'

/*
 * Issue #154 Global Assignment Phase D-0B: the runner protocol - conditions and their validation, the non-formal smoke
 * defaults, the refusal of a formal run, the stage classification with its design 10.3 role, and the progress journal that
 * keeps the confirmed progress of a run its envelope stopped (never the result of the Target in progress).
 */

const T = 'target.fixture.a' as TargetWeaponId

describe('Phase D-0B conditions and envelope', () => {
  it('accepts the smoke defaults and records a basis for each, none oracle-informed', () => {
    const { conditions, envelope } = smokeDefaults()
    expect(validateMaterializationResearchConditions(conditions)).toEqual([])
    expect(validateMaterializationEnvelope(envelope)).toEqual([])
    expect(conditions.window).toEqual(reachWindowW0())
    expect(conditions).toMatchObject({ structuralCandidateLimit: 1, coverageDrivenOrdering: true, searchPolicyPrecheck: true })
    // The gate always lets a fresh reservation (one conversion position) and the whole W0 window through.
    expect(conditions.searchScaleGate.maxConversionPositions).toBeGreaterThanOrEqual(1)
    expect(conditions.searchScaleGate).toMatchObject({ maxGogmaLegalWidth: 500, maxSkillLegalWidth: 1501, maxNormalForgeCount: 350 })
    for (const [key, value] of Object.entries(MATERIALIZATION_D0B_SMOKE_DEFAULTS)) {
      expect(value.basis.length, key).toBeGreaterThan(20)
      expect(value.oracleInformed, key).toBe(false)
      expect(value.basis, key).not.toMatch(/1,?657/)
    }
  })

  it('refuses every invalid condition with a named issue and never fills a default in', () => {
    const { conditions, envelope } = smokeDefaults()
    const issuesOf = (edit: Record<string, unknown>) => validateMaterializationResearchConditions({ ...conditions, ...edit })
    expect(issuesOf({ window: { normal: 0, gogma: 500, skill: 1500 } })).toEqual(['window.normal must be a positive integer (got 0).'])
    expect(issuesOf({ nodeBudget: 0 })[0]).toMatch(/^nodeBudget/)
    expect(issuesOf({ mrvLookahead: 1.5 })[0]).toMatch(/^mrvLookahead/)
    expect(issuesOf({ deliveryCap: -1 })[0]).toMatch(/^deliveryCap/)
    expect(issuesOf({ deliveryCap: undefined })[0]).toMatch(/^deliveryCap/)
    expect(issuesOf({ coverageDrivenOrdering: undefined })[0]).toMatch(/^coverageDrivenOrdering must be an explicit boolean/)
    expect(issuesOf({ structuralCandidateLimit: 0 })[0]).toMatch(/^structuralCandidateLimit/)
    expect(issuesOf({ structuralCandidateLimit: MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES + 1 })[0]).toMatch(/^structuralCandidateLimit/)
    expect(issuesOf({ searchScaleGate: { ...conditions.searchScaleGate, maxConversionPositions: -1 } })[0]).toMatch(/^searchScaleGate/)
    expect(issuesOf({ searchScaleGate: { maxConversionPositions: 1 } })[0]).toMatch(/^searchScaleGate/)
    expect(issuesOf({ searchPolicyPrecheck: false })).toEqual(['searchPolicyPrecheck must be true in Phase D-0B (got false).'])
    expect(validateMaterializationResearchConditions(null)).toEqual(['conditions must be an object.'])
    expect(validateMaterializationEnvelope({ ...envelope, childWallMs: 999 })[0]).toMatch(/^childWallMs/)
    expect(validateMaterializationEnvelope({ ...envelope, childHeapMb: 128 })[0]).toMatch(/^childHeapMb/)
    expect(validateMaterializationEnvelope({ ...envelope, repeat: 0 })[0]).toMatch(/^repeat/)
    expect(validateMaterializationEnvelope({ ...envelope, repeat: 3 })[0]).toMatch(/^repeat/)
  })

  it('refuses a formal run: D-0B registers nothing, the formal items are left to D-0B-2 / D-0C', () => {
    const issues = materializationFormalRunIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/registers no formal condition/)
    expect(issues[0]).toMatch(/D-0B-2/)
    expect(issues[0]).toMatch(/D-0C/)
    for (const item of ['deliveryCap', 'searchScaleGate', 'childWallMs', 'childHeapMb']) expect(MATERIALIZATION_D0B2_REGISTRATION_ITEMS).toContain(item)
  })
})

describe('Phase D-0B stage classification and design 10.3 role', () => {
  it('distinguishes every stage end, and never reads a Search-policy shape as a window, cap, gate or envelope question', () => {
    const cases: [MaterializationStageOutcome, CandidateMaterializationClass][] = [
      [{ kind: 'all_materialized' }, 'all_materialized'],
      [{ kind: 'materialization_failed', targetWeaponId: T, outcome: { kind: 'shape_mismatch', delivered: 3, closestMismatch: null } }, 'executed_shape_mismatch'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'unconfirmed', reason: 'stopped_by_extent', delivered: 1, closestMismatch: null } }, 'unconfirmed_stopped_by_extent'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'unconfirmed', reason: 'delivery_cap_reached', delivered: 9, closestMismatch: null } }, 'unconfirmed_delivery_cap'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'not_executed', reason: 'search_policy_shape', policyShape: { policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 3, finalPosition: 5 } } }, 'not_executed_search_policy'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'not_executed', reason: 'search_scale_gate', predictedSearchScale: { conversionPositions: 40, gogmaLegalWidth: 1, skillLegalWidth: 1, normalForgeCount: 0 }, exceeded: ['conversionPositions'] } }, 'not_executed_search_scale_gate'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'unmeasured', reason: 'cancelled' } }, 'unmeasured_cancelled'],
    ]
    for (const [stage, expected] of cases) expect(classifyMaterializationStage(stage)).toBe(expected)
    // Process-level ends belong to the parent; the in-process classification refuses them.
    expect(() => classifyMaterializationStage({ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'unmeasured', reason: 'timeout' } })).toThrow(/parent process/)

    expect(materializationFollowUp('not_executed_search_policy')).toEqual({ followUp: 'method_extension', windowExpansionBasis: false, settingsReviewBasis: false })
    expect(materializationFollowUp('executed_shape_mismatch')).toEqual({ followUp: 'executed_mismatch', windowExpansionBasis: true, settingsReviewBasis: false })
    for (const kind of ['unconfirmed_stopped_by_extent', 'unconfirmed_delivery_cap', 'not_executed_search_scale_gate', 'unmeasured_cancelled'] as const) {
      expect(materializationFollowUp(kind)).toEqual({ followUp: 'settings_review', windowExpansionBasis: false, settingsReviewBasis: true })
    }
    expect(materializationFollowUp('all_materialized')).toEqual({ followUp: 'planner_verification_pending', windowExpansionBasis: false, settingsReviewBasis: false })
    expect(materializationFollowUp('fail_closed').followUp).toBe('run_error')
  })
})

describe('Phase D-0B progress journal', () => {
  const brief = { kind: 'materialized' as const, reason: null, method: 'candidate_search_projected', delivered: null, deliveredBeforeMatch: 0 }
  const lines: ProgressJournalLine[] = [
    { kind: 'started', atMs: 0, pid: 7 },
    { kind: 'memory', atMs: 1, heapUsed: 100, heapTotal: 200, rss: 300, external: 1 },
    { kind: 'progress', atMs: 2, event: { kind: 'context', status: 'context', planningTargetCount: 2, reason: null } },
    { kind: 'progress', atMs: 3, event: { kind: 'reach_table', status: 'reach_table', predictions: { skill: 1, gogmaReset: 2, gogmaKeep: 3, normal: 4 } } },
    { kind: 'progress', atMs: 4, event: { kind: 'structural_candidate', candidateIndex: 0, ordinal: 0, objective: 9, expandedNodes: 2 } },
    { kind: 'progress', atMs: 5, event: { kind: 'structural_search', status: 'structural_candidates_found', completeness: 'candidate_limit_reached', expandedNodes: 2, structuralCandidates: 1, coverageRejections: 0 } },
    { kind: 'progress', atMs: 6, event: { kind: 'candidate_started', candidateIndex: 0, ordinal: 0, objective: 9, targetCount: 2 } },
    { kind: 'progress', atMs: 7, event: { kind: 'target_started', candidateIndex: 0, orderIndex: 0, targetWeaponId: 'target.fixture.a' } },
    { kind: 'progress', atMs: 9, event: { kind: 'target_settled', candidateIndex: 0, orderIndex: 0, targetWeaponId: 'target.fixture.a', outcome: brief } },
    { kind: 'memory', atMs: 10, heapUsed: 900, heapTotal: 1000, rss: 1200, external: 1 },
    { kind: 'progress', atMs: 11, event: { kind: 'target_started', candidateIndex: 0, orderIndex: 1, targetWeaponId: 'target.fixture.c' } },
    { kind: 'memory', atMs: 12, heapUsed: 500, heapTotal: 1000, rss: 1100, external: 1 },
  ]
  const text = lines.map(line => JSON.stringify(line)).join('\n')

  it('keeps every settled fact and leaves the Target in progress without an outcome when the journal stops mid-run', () => {
    // A kill can cut the last line: it is counted as malformed, never parsed as a fact.
    const progress = parseProgressJournal(`${text}\n{"kind":"progress","atMs":13,"event":{"kind":"target_sett`)
    expect(progress).toMatchObject({ lines: 13, malformedLines: 1, started: true, finished: false, lastAtMs: 12 })
    expect(progress.context).toMatchObject({ planningTargetCount: 2 })
    expect(progress.reachTable).toMatchObject({ atMs: 3, event: { predictions: { gogmaKeep: 3 } } })
    expect(progress.structuralCandidates).toEqual([{ candidateIndex: 0, ordinal: 0, objective: 9, expandedNodes: 2, atMs: 4 }])
    expect(progress.structuralSearch).toMatchObject({ atMs: 5, event: { status: 'structural_candidates_found' } })
    expect(progress.candidates).toHaveLength(1)
    const [candidate] = progress.candidates
    expect(candidate!.settledTargets).toEqual([{ orderIndex: 0, targetWeaponId: 'target.fixture.a', outcome: brief, startedAtMs: 7, settledAtMs: 9 }])
    expect(candidate!.targetInProgress).toEqual({ orderIndex: 1, targetWeaponId: 'target.fixture.c', startedAtMs: 11 })
    expect(candidate!.settled).toBeNull()
    expect(progress.memory).toEqual({ samples: 3, last: { atMs: 12, heapUsed: 500, heapTotal: 1000, rss: 1100 }, maxHeapUsed: 900, maxRss: 1200 })
  })

  it('reads a finished journal and tolerates blank lines and Windows line ends', () => {
    const finished = [...lines,
      { kind: 'progress', atMs: 14, event: { kind: 'target_settled', candidateIndex: 0, orderIndex: 1, targetWeaponId: 'target.fixture.c', outcome: brief } },
      { kind: 'progress', atMs: 15, event: { kind: 'candidate_settled', candidateIndex: 0, classification: 'all_materialized', materializedTargetCount: 2, notAttemptedTargetCount: 0 } },
      { kind: 'finished', atMs: 16 },
    ] as ProgressJournalLine[]
    const progress = parseProgressJournal(`${finished.map(line => JSON.stringify(line)).join('\r\n')}\r\n\r\n`)
    expect(progress).toMatchObject({ malformedLines: 0, started: true, finished: true, lastAtMs: 16 })
    expect(progress.candidates[0]!.targetInProgress).toBeNull()
    expect(progress.candidates[0]!.settled).toEqual({ classification: 'all_materialized', materializedTargetCount: 2, notAttemptedTargetCount: 0, atMs: 15 })
    expect(parseProgressJournal('')).toMatchObject({ lines: 0, started: false, candidates: [] })
    // A line that is JSON but not a journal line is malformed too.
    expect(parseProgressJournal('{"kind":"progress"}\n[1,2]\n').malformedLines).toBe(2)
  })
})
