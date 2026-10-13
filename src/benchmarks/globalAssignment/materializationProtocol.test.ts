import { describe, expect, it } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/common'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { parseRegisteredExportIdentity } from './assignmentProtocol'
import {
  classifyMaterializationStage, d0cExportIdentityDifferences, d0cRegisteredItemKeys, d0cRegistrationGate, differencesFromD0cRegistration, MATERIALIZATION_D0A2B_PROTOCOL_VERSION,
  MATERIALIZATION_D0A2B_REGISTRATION_ITEMS, MATERIALIZATION_D0B_SMOKE_DEFAULTS, MATERIALIZATION_D0B2_DOC, MATERIALIZATION_D0B2_REGISTRATION_ITEMS,
  MATERIALIZATION_D0C_EXTRA_REGISTRATION_ITEMS, MATERIALIZATION_D0C_PREREGISTRATION, MATERIALIZATION_REACH_OPTION_SETS, materializationD0cRegistrationIssues,
  materializationFollowUp, materializationFormalRunIssues, materializationProtocolVersion, MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES, parseProgressJournal,
  readD0cRegisteredExportIdentity, registeredD0cConditions, smokeDefaults, validateMaterializationEnvelope, validateMaterializationResearchConditions,
  validateShapeMaterializationResearchConditions, type CandidateMaterializationClass, type D0cRegisteredItem, type D0cRegistration, type ProgressJournalLine,
} from './materializationProtocol'
import type { MaterializationStageOutcome } from './materializationTypes'
import { reachWindowW0 } from './reachTable'
import { CONTINUATION_SHAPE_DETECTORS } from './shapeMaterializationRequest'
import { REACH_OPTION_SET_A1, REACH_OPTION_SET_A2 } from './types'
import type { TargetWeaponId } from '../../domain/models/publicTypes'

/*
 * Issue #154 Global Assignment Phase D-0B: the runner protocol - conditions and their validation, the non-formal smoke
 * defaults, the registration gate of a formal run, the stage classification with its design 10.3 role, and the progress journal that
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

  it('gates a formal run by its registration: D-0B registers none, D-0B-2 registered the D-0C conditions, D-0C enabled them', () => {
    // D-0C enabled the registered formal run; a disabled or incomplete registration (synthetic here) is still refused.
    expect(materializationFormalRunIssues()).toEqual([])
    const disabled = { ...MATERIALIZATION_D0C_PREREGISTRATION, formalRun: { enabled: false, enabledBy: null, startsIn: 'D-0C' } } as unknown as D0cRegistration
    expect(materializationFormalRunIssues(disabled)).toEqual([expect.stringMatching(/^A formal run is not enabled .*rule d0a2-v2 only; use --mode smoke\.$/)])
    const incomplete = { ...MATERIALIZATION_D0C_PREREGISTRATION, childWallMs: undefined } as unknown as D0cRegistration
    expect(materializationFormalRunIssues(incomplete)).toEqual(['The D-0C pre-registration is incomplete: childWallMs is not registered.'])
    // The D-0B (d0a-v1) items stay a D-0B-2 list; the d0a-v1 smoke defaults are never a formal condition.
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

/*
 * Phase D-0B-2 (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md`): the D-0C formal conditions of the rule d0a2-v2, pre-registered
 * from the non-formal re-smokes. Every item carries its value and the record of why; the conditions are the runner's own d0a2-v2
 * shape; Phase D-0C enabled the formal mode without changing a value; the d0a-v1 smoke defaults are not the registration. Hashes
 * stay in the documents.
 */
const d0b2Document = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md', { query: '?raw', import: 'default', eager: true }))[0] as string
const b2aDocument = Object.values(import.meta.glob('../../../docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md', { query: '?raw', import: 'default', eager: true }))[0] as string

describe('Phase D-0B-2 pre-registration of the D-0C conditions', () => {
  const registration = MATERIALIZATION_D0C_PREREGISTRATION as unknown as Record<string, D0cRegisteredItem<unknown>>

  it('registers every D-0A-2b item and every D-0B-2 extra item, each with value, unit, basis, evidence, oracle flag and observed / unconfirmed range', () => {
    expect(materializationD0cRegistrationIssues()).toEqual([])
    const required = [...MATERIALIZATION_D0A2B_REGISTRATION_ITEMS, ...MATERIALIZATION_D0C_EXTRA_REGISTRATION_ITEMS]
    expect(new Set(required).size).toBe(required.length)
    expect([...d0cRegisteredItemKeys()].sort()).toEqual([...required].sort())
    for (const key of required) {
      const item = registration[key]!
      expect(item.value, key).not.toBeNull()
      expect(item.value, key).not.toBeUndefined()
      expect(item.unit.length, key).toBeGreaterThan(5)
      expect(item.basis.length, key).toBeGreaterThan(40)
      expect(item.evidence.length, key).toBeGreaterThan(0)
      expect(item.oracleInformed, key).toBe(false)
      expect(item.observedRange.length, key).toBeGreaterThan(0)
      expect(item.unconfirmedRange.length, key).toBeGreaterThan(0)
      // No oracle value, no Export hash, no Target / weapon ID in a registered value or its record (design 11.3).
      const text = JSON.stringify(item)
      expect(text, key).not.toMatch(/1,?657|oracle manifest/i)
      expect(text, key).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(text, key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    }
  })

  it('registers the rule d0a2-v2 with the a2 option set, the independent Route checks, the continuation shapes and the Phase C order', () => {
    const { conditions, envelope } = registeredD0cConditions()
    expect(validateShapeMaterializationResearchConditions(conditions)).toEqual([])
    expect(validateMaterializationEnvelope(envelope)).toEqual([])
    expect(conditions.rule).toBe('d0a2-v2')
    expect(conditions.reachOptionSet).toBe(REACH_OPTION_SET_A2)
    expect(MATERIALIZATION_REACH_OPTION_SETS.a2).toBe(REACH_OPTION_SET_A2)
    expect(conditions.routeVerification).toBe('every_shape_constrained_materialization')
    expect(conditions).not.toHaveProperty('deliveryCap')
    expect(conditions).not.toHaveProperty('searchPolicyPrecheck')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.materializationOrderRule.value).toBe('phase-c-design-8.2')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.materializationOrderRule.basis).toMatch(/Phase C order is kept/)
    // G1 and G2: the two continuation detectors and their policies, in detector order.
    expect(CONTINUATION_SHAPE_DETECTORS.map(detector => detector.name)).toEqual(['conversionSkillContinuationShapeOf', 'ownedGogmaContinuationShapeOf'])
    expect(MATERIALIZATION_D0C_PREREGISTRATION.continuationShapeRule.value).toEqual(['lane_start_ideal_skill_continuation', 'lane_start_ideal_owned_gogma_continuation'])
    expect(MATERIALIZATION_D0C_PREREGISTRATION.researchProtocolVersion.value).toBe(MATERIALIZATION_D0A2B_PROTOCOL_VERSION)
    expect(materializationProtocolVersion(conditions)).toBe(MATERIALIZATION_D0A2B_PROTOCOL_VERSION)
    expect(envelope.repeat).toBe(2)
    expect(MATERIALIZATION_D0C_PREREGISTRATION).toMatchObject({ concurrency: 1, retry: 'none' })
  })

  it('derives the shape gate and the prediction budget from the W0 bounds, and keeps the runtime budgets above every D-0B-2 observation', () => {
    const W0 = reachWindowW0()
    const { conditions, envelope } = registeredD0cConditions()
    expect(conditions.window).toEqual(W0)
    // Design D0A2 10.3 at its W0 maximum: own-operation depth ≤ Skill lane (≤ window.skill positions) + Gogma lane (≤ window.gogma),
    // generated states ≤ depth × non-blocked Gogma positions × (longest held run + 2), forges ≤ window.normal, walk ≤ window.skill + 1.
    const depth = W0.skill + W0.gogma
    expect(conditions.shapeSearchScaleGate).toEqual({
      maxDepthUpperBound: depth, maxGogmaGeneratedStateUpperBound: depth * W0.gogma * (W0.gogma + 2), maxNormalForgeCount: W0.normal, maxConversionWalkPositions: W0.skill + 1,
    })
    // The memo bounds: distinct Normal / Skill / Gogma positions inside W0.
    expect(conditions.shapeSearchBudget.maxPredictions).toEqual({ normalArtian: W0.normal, skill: W0.skill + 1, gogmaReset: W0.gogma, gogmaKeep: W0.gogma })
    expect(conditions.shapeSearchBudget.maxSkillStates).toBe(W0.skill * W0.skill)
    // The D-0B-2 observed maxima (d0b2-r1, docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md) stay below every budget component.
    const observed = { gogmaGeneratedStates: 121_959, skillStates: 27_539, settledWork: 397, predictions: { normalArtian: 1, skill: 532, gogmaReset: 171, gogmaKeep: 293 } }
    expect(conditions.shapeSearchBudget.maxGogmaGeneratedStates).toBeGreaterThan(observed.gogmaGeneratedStates)
    expect(conditions.shapeSearchBudget.maxSkillStates).toBeGreaterThan(observed.skillStates)
    expect(conditions.shapeSearchBudget.maxSettledWork).toBeGreaterThan(observed.settledWork)
    for (const kind of ['normalArtian', 'skill', 'gogmaReset', 'gogmaKeep'] as const) expect(conditions.shapeSearchBudget.maxPredictions[kind], kind).toBeGreaterThanOrEqual(observed.predictions[kind])
    // The largest predicted upper bound of an executed Search (21,462,381) is inside the gate; the projected gate is the D-0B one.
    expect(conditions.shapeSearchScaleGate.maxGogmaGeneratedStateUpperBound).toBeGreaterThan(21_462_381)
    expect(conditions.projectedSearchScaleGate).toEqual(smokeDefaults().conditions.searchScaleGate)
    expect(conditions).toMatchObject({ nodeBudget: 2_000, mrvLookahead: 8, coverageDrivenOrdering: true, structuralCandidateLimit: 1 })
    expect(envelope).toEqual({ childWallMs: 30 * 60_000, childHeapMb: 4_096, repeat: 2 })
  })

  it('records the CalculationContext and the Engine version the D-0B-2 children ran with, equal to the current authorities', () => {
    const master = loadMasterData()
    if (!master.ok) throw new Error('Master data failed to load.')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value).toEqual({
      gameVersion: master.data.manifest.gameVersion, masterDataVersion: master.data.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    })
  })

  it('D-0C: enables the formal mode without changing a registered value, and keeps the d0a-v1 smoke defaults apart from the registration', () => {
    expect(MATERIALIZATION_D0C_PREREGISTRATION.formalRun).toEqual({ enabled: true, enabledBy: expect.stringMatching(/^Phase D-0C: .*without changing a registered value/), startsIn: 'D-0C' })
    expect(materializationFormalRunIssues()).toEqual([])
    expect(d0cRegistrationGate()).toEqual({ formalRunEnabled: true, registrationIssues: [] })
    // Every registered value, exactly as Phase D-0B-2 registered it (PR #251): the formal run measures these and nothing else.
    const { conditions, envelope } = registeredD0cConditions()
    expect(conditions).toEqual({
      rule: 'd0a2-v2', window: { normal: 350, gogma: 500, skill: 1_500 }, nodeBudget: 2_000, mrvLookahead: 8, coverageDrivenOrdering: true, structuralCandidateLimit: 1,
      projectedSearchScaleGate: { maxConversionPositions: 32, maxGogmaLegalWidth: 500, maxSkillLegalWidth: 1_501, maxNormalForgeCount: 350 },
      shapeSearchScaleGate: { maxDepthUpperBound: 2_000, maxGogmaGeneratedStateUpperBound: 502_000_000, maxNormalForgeCount: 350, maxConversionWalkPositions: 1_501 },
      shapeSearchBudget: { maxGogmaGeneratedStates: 50_000_000, maxSkillStates: 2_250_000, maxSettledWork: 100_000, maxPredictions: { normalArtian: 350, skill: 1_501, gogmaReset: 500, gogmaKeep: 500 } },
      routeVerification: 'every_shape_constrained_materialization', reachOptionSet: 'global-assignment-reach-options:a2',
    })
    expect(envelope).toEqual({ childWallMs: 1_800_000, childHeapMb: 4_096, repeat: 2 })
    expect(MATERIALIZATION_D0C_PREREGISTRATION).toMatchObject({ concurrency: 1, retry: 'none', registeredIn: 'Phase D-0B-2' })
    expect(MATERIALIZATION_D0C_PREREGISTRATION.continuationShapeRule.value).toEqual(['lane_start_ideal_skill_continuation', 'lane_start_ideal_owned_gogma_continuation'])
    expect(MATERIALIZATION_D0C_PREREGISTRATION.materializationOrderRule.value).toBe('phase-c-design-8.2')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.methodSelectionRule.value).toBe('d0a2-v2')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.calculationContext.value).toEqual({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 })
    expect(MATERIALIZATION_D0C_PREREGISTRATION.researchProtocolVersion.value).toBe('global-assignment-d0a2b:1')
    expect(MATERIALIZATION_D0C_PREREGISTRATION.repositoryRule.value).toBe('clean_head_no_uncommitted_code_calculation_diff_audited')
    // The D-0B (d0a-v1) smoke defaults and registration items are unchanged and are not the registered conditions.
    expect(MATERIALIZATION_D0B2_REGISTRATION_ITEMS).toEqual(['deliveryCap', 'searchScaleGate', 'childWallMs', 'childHeapMb', 'nodeBudget', 'structuralCandidateLimit', 'optionSetVersion', 'methodSelectionRule', 'searchPolicyShapeRule'])
    expect(smokeDefaults().conditions).toMatchObject({ deliveryCap: 500, searchPolicyPrecheck: true })
    expect(smokeDefaults().conditions).not.toHaveProperty('rule')
    expect(smokeDefaults().conditions).not.toHaveProperty('reachOptionSet')
  })

  it('names every field a run differs from the registration by, and reads an absent option set as a1', () => {
    const { conditions, envelope } = registeredD0cConditions()
    expect(differencesFromD0cRegistration(conditions, envelope)).toEqual([])
    const a1 = { ...conditions }
    delete a1.reachOptionSet
    expect(differencesFromD0cRegistration(a1, envelope)).toEqual([`reachOptionSet: "${REACH_OPTION_SET_A1}" (registered "${REACH_OPTION_SET_A2}")`])
    expect(differencesFromD0cRegistration({ ...conditions, reachOptionSet: REACH_OPTION_SET_A1 }, { ...envelope, repeat: 1, childHeapMb: 8_192 })).toEqual([
      `reachOptionSet: "${REACH_OPTION_SET_A1}" (registered "${REACH_OPTION_SET_A2}")`, 'childHeapMb: 8192 (registered 4096)', 'repeat: 1 (registered 2)',
    ])
    const budget = { ...conditions.shapeSearchBudget, maxPredictions: { ...conditions.shapeSearchBudget.maxPredictions, gogmaKeep: 1_000 } }
    const changed = differencesFromD0cRegistration({ ...conditions, shapeSearchBudget: budget }, envelope)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatch(/^shapeSearchBudget: /)
    // A d0a-v1 run differs by its rule and every d0a2-v2 field it does not carry.
    const v1 = differencesFromD0cRegistration(smokeDefaults().conditions, smokeDefaults().envelope)
    expect(v1[0]).toBe('rule: "d0a-v1" (registered "d0a2-v2")')
    expect(v1.join('\n')).toMatch(/projectedSearchScaleGate: null/)
    expect(v1.join('\n')).toMatch(/reachOptionSet: "global-assignment-reach-options:a1"/)
  })

  it('reads the registered Export identity from the D-0B-2 document: the B-2B registered Export, compared field by field', () => {
    expect(MATERIALIZATION_D0B2_DOC).toBe('docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md')
    const registered = readD0cRegisteredExportIdentity(d0b2Document)
    expect(registered.issues).toEqual([])
    expect(registered.identity).toEqual(parseRegisteredExportIdentity(b2aDocument).identity)
    // Shape only: the hash itself stays in the documents.
    expect(registered.identity!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d0cExportIdentityDifferences(registered.identity!, registered.identity!)).toEqual([])
    expect(d0cExportIdentityDifferences({ ...registered.identity!, bytes: registered.identity!.bytes + 1 }, registered.identity!)).toHaveLength(1)
    expect(readD0cRegisteredExportIdentity('# no block').identity).toBeNull()
  })
})
