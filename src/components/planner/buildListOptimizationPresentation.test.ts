import { beforeAll, describe, expect, it } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { ProductionPlan, TargetWeaponId } from '../../domain/models/publicTypes'
import type { BuildListOptimizationArtifact, BuildListOptimizationResult, BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import type {
  BuildListOptimizationSessionFailure,
  BuildListOptimizationSessionState,
} from '../../services/planner/buildListOptimizationService'
import {
  BONUS_ONLY_TARGET_ID,
  MIXED_KEEP_TARGET_ID,
  SKILL_ONLY_TARGET_ID,
  type BuildListOptimizationAdoptionFixture,
} from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import {
  BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS,
  optimizedPresentationFixture,
  ordinaryDraftFromSameInput,
  presentationTestMaster,
  startContextOf,
} from '../../test/fixtures/buildListOptimizationPresentationFixtures'
import {
  BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE_DELAY_MS,
  buildListOptimizationOutcomeOf,
  buildListOptimizationStageLabels,
  buildListOptimizationStageStatusText,
  compareBuildListOptimizationWithDraft,
  createBuildListOptimizationPreviewModel,
  createBuildListOptimizationTargetResolver,
  isDraftComparableWithBuildListOptimization,
  presentBuildListOptimizationFailure,
  presentBuildListOptimizationUnsupportedReason,
} from './buildListOptimizationPresentation'

let master: MasterDataRoot
let fixture: BuildListOptimizationAdoptionFixture
let artifact: BuildListOptimizationArtifact

beforeAll(async () => {
  master = presentationTestMaster()
  fixture = await optimizedPresentationFixture('scoped')
  artifact = fixture.artifact
})

describe('running state', () => {
  it('names every stage in Japanese and still says the run is starting before the first stage arrives', () => {
    const stages: BuildListOptimizationStage[] = ['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification']
    expect(stages.map((stage) => buildListOptimizationStageLabels[stage])).toEqual([
      '入力確認', '到達条件の計算', '割当の探索', 'ルートの生成', '計画の検証',
    ])
    expect(buildListOptimizationStageStatusText('route_generation')).toBe('現在の段階：ルートの生成')
    expect(buildListOptimizationStageStatusText(null)).toBe('現在の段階：計算を開始しています')
  })

  it('shows the long-run notice from 30 s (a display threshold)', () => {
    expect(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE_DELAY_MS).toBe(30_000)
  })
})

describe('buildListOptimizationOutcomeOf', () => {
  it('reads the finished session states and none of the running ones', () => {
    const notFound: BuildListOptimizationResult = { status: 'not_found', reason: 'candidates_rejected', diagnostics: BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS }
    const completed: BuildListOptimizationSessionState = {
      status: 'completed', runId: 1,
      completion: { decidedBy: 'calculation', result: notFound, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } },
    }
    expect(buildListOptimizationOutcomeOf(completed)).toEqual({ kind: 'result', result: notFound })
    const refused: BuildListOptimizationSessionState = {
      status: 'completed', runId: 2,
      completion: { decidedBy: 'application', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } },
    }
    expect(buildListOptimizationOutcomeOf(refused)).toEqual({ kind: 'result', result: { status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] } })
    expect(buildListOptimizationOutcomeOf({ status: 'cancelled', runId: 3, reason: 'page_hidden' })).toEqual({ kind: 'cancelled', reason: 'page_hidden' })
    const failure: BuildListOptimizationSessionFailure = { kind: 'worker_message_error' }
    expect(buildListOptimizationOutcomeOf({ status: 'failed', runId: 4, failure })).toEqual({ kind: 'failed', failure })
    for (const state of [
      { status: 'idle' },
      { status: 'preparing', runId: 5 },
      { status: 'running', runId: 6, requestId: 'r', stage: 'reach_table', startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } },
      { status: 'disposed' },
    ] as BuildListOptimizationSessionState[]) {
      expect(buildListOptimizationOutcomeOf(state)).toBeNull()
    }
  })
})

describe('presentBuildListOptimizationFailure', () => {
  const failures: BuildListOptimizationSessionFailure[] = [
    { kind: 'worker_unavailable', message: 'no Worker' },
    { kind: 'worker_start_failed', message: 'boom' },
    { kind: 'worker_error', message: 'Out of memory' },
    { kind: 'worker_message_error' },
    { kind: 'start_read_failed', code: 'transaction_failed', message: 'read failed' },
    { kind: 'calculation_error', code: 'calculation_failed', domainCode: null, stage: 'plan_verification', message: 'planner failed' },
    { kind: 'calculation_error', code: 'invariant_violation', domainCode: 'objective_mismatch', stage: 'plan_verification', message: 'identity broke' },
    { kind: 'calculation_error', code: 'materialization_failed', domainCode: 'x', stage: 'route_generation', message: 'materialization' },
    { kind: 'calculation_error', code: 'invalid_request', domainCode: null, stage: null, message: 'bad request' },
    { kind: 'calculation_error', code: 'worker_already_used', domainCode: null, stage: null, message: 'used' },
    { kind: 'calculation_error', code: 'search_bounds_unavailable', domainCode: null, stage: null, message: 'no bounds' },
    { kind: 'protocol_violation', issues: ['bad'] },
    { kind: 'invalid_result', issues: ['bad'] },
  ]

  it('keeps a Worker failure a calculation failure and a broken premise a contract violation, by the typed kind only', () => {
    expect(failures.map((failure) => presentBuildListOptimizationFailure(failure).category)).toEqual([
      'calculation_failed', 'calculation_failed', 'calculation_failed', 'calculation_failed', 'calculation_failed', 'calculation_failed',
      'contract_violation', 'contract_violation', 'contract_violation', 'contract_violation', 'contract_violation',
      'contract_violation', 'contract_violation',
    ])
    // A contract violation repeats on the same input: running again is offered for the calculation failures only.
    expect(presentBuildListOptimizationFailure(failures[6]).retryable).toBe(false)
    expect(presentBuildListOptimizationFailure(failures[2]).retryable).toBe(true)
  })

  it('never presumes a lack of memory, shows no Worker message and never reads as unsupported or not found', () => {
    for (const failure of failures) {
      const { message } = presentBuildListOptimizationFailure(failure)
      expect(message).not.toMatch(/メモリ|memory/i)
      expect(message).not.toMatch(/見つけられませんでした|使えません/)
      if ('message' in failure && failure.message !== null) expect(message).not.toContain(failure.message)
    }
  })
})

describe('presentBuildListOptimizationUnsupportedReason', () => {
  it('names the Targets by name, weapon type and element, never by ID, and counts the unresolved ones', () => {
    const resolve = createBuildListOptimizationTargetResolver(fixture.input.targetWeapons, master)
    const presentation = presentBuildListOptimizationUnsupportedReason(
      { kind: 'target_without_source', targetWeaponIds: [BONUS_ONLY_TARGET_ID, 'target.unknown' as TargetWeaponId, BONUS_ONLY_TARGET_ID] },
      resolve,
    )
    expect(presentation.targets.targets).toEqual([
      { key: BONUS_ONLY_TARGET_ID, name: 'Issue 103 bonus-only', weaponLabel: '太刀 / 火' },
    ])
    expect(presentation.targets.unresolvedCount).toBe(1)
    expect(JSON.stringify([presentation.title, presentation.description, presentation.missingItems, presentation.links])).not.toContain('target.')
    expect(presentation.links.map(({ to }) => to)).toEqual(['/normal-counters', '/owned-weapons'])
  })

  it('names the missing RNG values by name only, and routes each reason to where it is resolved', () => {
    const resolve = createBuildListOptimizationTargetResolver(null, master)
    const rng = presentBuildListOptimizationUnsupportedReason({ kind: 'unconfirmed_rng_state', missing: ['base_seed', 'gogma_counter'] }, resolve)
    expect(rng.missingItems).toEqual(['Base Seed（基準シード）', '巨戟カウンター'])
    expect(rng.links).toEqual([{ to: '/rng', label: 'RNG状態設定へ' }])
    const checkpoint = presentBuildListOptimizationUnsupportedReason(
      { kind: 'checkpoint_selection', entries: [{ buildListEntryId: 'build-list.x' as never, targetWeaponId: MIXED_KEEP_TARGET_ID }] },
      resolve,
    )
    // No Targets were given: the Target is not named and never shown as its ID.
    expect(checkpoint.targets).toEqual({ targets: [], unresolvedCount: 1 })
    expect(presentBuildListOptimizationUnsupportedReason({ kind: 'running_plan_exists' }, resolve).links).toEqual([{ to: '/plans', label: '生産計画一覧を見る' }])
    expect(presentBuildListOptimizationUnsupportedReason({ kind: 'no_planning_target' }, resolve).links).toEqual([{ to: '/search', label: '候補検索へ' }])
  })
})

describe('createBuildListOptimizationPreviewModel', () => {
  it('reads the figures from the artifact summary and the final Plan, the planning Targets the only denominator', () => {
    const model = createBuildListOptimizationPreviewModel(artifact, startContextOf(fixture.input), master)
    expect(model).not.toBeNull()
    if (model === null) return
    expect(model.planningTargetCount).toBe(artifact.summary.totalTargetCount)
    expect(model.planningTargetCount).toBe(3)
    // Seven registered Targets, three planning ones: the four out-of-scope Targets never join the denominator.
    expect(fixture.input.targetWeapons).toHaveLength(7)
    expect(model.plannedCompletionTargetCount).toBe(3)
    expect(model.outOfScopeTotal).toBe(4)
    expect(model.outOfScopeRows.map(({ key, count }) => [key, count])).toEqual([
      ['noEntry', 1], ['excludedEntryOnly', 2], ['disabled', 0], ['completed', 1],
    ])
    expect([model.physicalOperationCount, model.planStepCount, model.nonPhysicalStepCount]).toEqual([
      artifact.summary.physicalOperationCount, artifact.summary.planStepCount, artifact.summary.nonPhysicalStepCount,
    ])
    expect(model.conflictCount).toBe(0)
  })

  it('shows the replacements with their start-time route bases and the improvement preference that returns to planner', () => {
    const model = createBuildListOptimizationPreviewModel(artifact, startContextOf(fixture.input), master)
    if (model === null) throw new Error('no model')
    expect(model.replacements.map(({ target }) => target?.name)).toEqual(['Issue 103 mixed-keep', 'Issue 103 bonus-only'])
    const bonusOnly = model.replacements[1]
    expect(bonusOnly.before).toEqual({ kind: 'owned', name: 'Issue 103 source bonus-only', weaponKindLabel: '巨戟アーティア' })
    expect(bonusOnly.after).toEqual(bonusOnly.before)
    expect(bonusOnly.sourceChanged).toBe(false)
    expect(bonusOnly.previousImprovementPreference).toBe('bonus_first')
    expect(model.preferenceResets.map(({ target }) => target?.key)).toEqual([BONUS_ONLY_TARGET_ID])
    // The mixed-keep Entry already used planner: nothing returns for it.
    expect(model.replacements[0].previousImprovementPreference).toBe('planner')
    expect(model.unchangedTargets.targets.map(({ key }) => key)).toEqual([SKILL_ONLY_TARGET_ID])
    expect(model.preferredSourceDifferences).toEqual([])
  })

  it('names a preferred weapon the new Route does not start from, and a source change to a new Normal Artian', () => {
    const context = startContextOf(fixture.input)
    const replacedId = artifact.replacements.find(({ targetWeaponId }) => targetWeaponId === BONUS_ONLY_TARGET_ID)?.replacedBuildListEntryId
    const changed = {
      ...context,
      targetWeapons: context.targetWeapons.map((target) =>
        target.id === BONUS_ONLY_TARGET_ID ? { ...target, preferredOwnedWeaponId: fixture.input.ownedWeapons[1].id } : target),
      buildListEntries: context.buildListEntries.map((entry) => entry.id !== replacedId ? entry : {
        ...entry,
        candidateSnapshot: { ...entry.candidateSnapshot, route: { ...entry.candidateSnapshot.route, sourceOwnedWeaponId: null } },
      }),
    }
    const model = createBuildListOptimizationPreviewModel(artifact, changed, master)
    if (model === null) throw new Error('no model')
    const bonusOnly = model.replacements.find(({ target }) => target?.key === BONUS_ONLY_TARGET_ID)
    expect(bonusOnly?.before).toEqual({ kind: 'new_normal' })
    expect(bonusOnly?.sourceChanged).toBe(true)
    expect(bonusOnly?.preferredSourceNotUsed).toEqual({ preferredName: fixture.input.ownedWeapons[1].name })
    expect(model.preferredSourceDifferences.map(({ target }) => target?.key)).toEqual([BONUS_ONLY_TARGET_ID])
  })

  it('guesses nothing without the start context: no name, base or preference is derived from IDs', () => {
    const model = createBuildListOptimizationPreviewModel(artifact, null, master)
    if (model === null) throw new Error('no model')
    expect(model.startContextAvailable).toBe(false)
    expect(model.replacements.every(({ target, before, previousImprovementPreference, sourceChanged }) =>
      target === null && before.kind === 'unavailable' && previousImprovementPreference === null && sourceChanged === null)).toBe(true)
    // The generated Entry is the artifact's own, but the owned weapon it names is the start context's.
    expect(model.replacements.every(({ after }) => after.kind === 'owned_unresolved')).toBe(true)
    expect(model.preferenceResets).toEqual([])
    expect(model.unchangedTargets).toEqual({ targets: [], unresolvedCount: 1 })
    // The counts stay the artifact's.
    expect(model.planningTargetCount).toBe(3)
    expect(model.replacements).toHaveLength(2)
  })

  it('reports an empty replacement set when every Target stays unchanged', async () => {
    const unchanged = await optimizedPresentationFixture('unchanged')
    const model = createBuildListOptimizationPreviewModel(unchanged.artifact, startContextOf(unchanged.input), master)
    expect(model?.replacements).toEqual([])
    expect(model?.unchangedTargets.targets).toHaveLength(3)
  })
})

describe('compareBuildListOptimizationWithDraft', () => {
  let draft: ProductionPlan
  beforeAll(async () => {
    draft = await ordinaryDraftFromSameInput(fixture)
  })

  it('compares a Draft the ordinary Planner made from the very same input state, figure by figure from each record', () => {
    expect(isDraftComparableWithBuildListOptimization(draft, artifact)).toBe(true)
    const comparison = compareBuildListOptimizationWithDraft(artifact, draft)
    expect(comparison.status).toBe('comparable')
    if (comparison.status !== 'comparable') return
    const physical = draft.steps.filter(({ operationType }) => operationType !== 'confirm_owned_ideal').length
    expect(comparison.rows.map(({ key, draft: draftValue, preview }) => [key, draftValue, preview])).toEqual([
      ['completion', expect.any(String), '3'],
      ['physical_operations', String(physical), String(artifact.summary.physicalOperationCount)],
      ['plan_steps', String(draft.steps.length), String(artifact.summary.planStepCount)],
      ['conflicts', draft.conflicts.length === 0 ? 'なし' : `${draft.conflicts.length}件`, 'なし'],
    ])
    expect(comparison.rows[0].label).toBe('完成予定の目標武器数（今回の計画対象3本中）')
  })

  it('compares nothing when the Draft was not made from the same input state', () => {
    const variants: [string, ProductionPlan][] = [
      ['calculation context', { ...draft, calculationContext: { ...draft.calculationContext, rngEngineVersion: 'production-rng:other' } }],
      ['snapshot calculation context', { ...draft, baseSnapshot: { ...draft.baseSnapshot, calculationContext: { ...draft.baseSnapshot.calculationContext, appSchemaVersion: 16 } } }],
      ['initial execution state', { ...draft, baseSnapshot: { ...draft.baseSnapshot, initialExecutionState: { ...draft.baseSnapshot.initialExecutionState, ownedWeaponsHash: 'fnv1a32:00000000' } } }],
      ['target weapons hash', { ...draft, baseSnapshot: { ...draft.baseSnapshot, targetWeaponsHash: 'fnv1a32:00000000' } }],
      ['build list entries hash', { ...draft, baseSnapshot: { ...draft.baseSnapshot, buildListEntriesHash: 'fnv1a32:00000000' } }],
      ['status', { ...draft, status: 'active' }],
    ]
    for (const [, variant] of variants) {
      expect(compareBuildListOptimizationWithDraft(artifact, variant)).toEqual({ status: 'not_comparable' })
    }
    // The optimized Plan's own snapshot names the replaced Build List, not the input one: it is not "the same input".
    const optimizedPlan = artifact.plannerResult.plan as ProductionPlan
    expect(isDraftComparableWithBuildListOptimization(optimizedPlan, artifact)).toBe(false)
    expect(compareBuildListOptimizationWithDraft(artifact, null)).toEqual({ status: 'no_draft' })
  })
})
