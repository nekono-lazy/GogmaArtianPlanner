import { describe, expect, it } from 'vitest'
import {
  executionSavePointIdForPlan,
  migrateExportRootV8ToV9,
  prepareExportRootForImport,
  validateExecutionHistory,
  validateProductionPlan,
  type ExecutionHistory,
  type ExportRootV8,
  type ProductionPlan,
  type RngState,
} from './publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  createRestorationBonusSet,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'

function issuePaths(plan: ProductionPlan): string[] {
  return validateProductionPlan(plan).issues.map(({ path }) => path)
}

/** A calculation schema 12 shaped Plan with two Steps, for progression rules. */
function currentPlan(): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.calculationContext.appSchemaVersion = 12
  plan.baseSnapshot.calculationContext.appSchemaVersion = 12
  const state = { ...plan.steps[0].expectedStateBefore, targetExecutionStateHash: 'hash.fixture.target' }
  plan.baseSnapshot.initialExecutionState = state
  plan.baseSnapshot.dependentTargetDefinitionsHash = 'hash.fixture.dependent-targets'
  plan.baseSnapshot.dependentBuildListEntriesHash = 'hash.fixture.dependent-entries'
  const step = {
    ...plan.steps[0],
    operationType: 'confirm_owned_ideal' as const,
    ownedWeaponId: 'owned.fixture.a' as ProductionPlan['steps'][number]['ownedWeaponId'],
    expectedStateBefore: state,
    expectedStateAfter: state,
    executionEffects: {
      trackedOwnedWeaponId: 'owned.fixture.a' as never,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: [{ buildListEntryId: 'build-list.fixture.a' as never, targetWeaponId: 'target.fixture.a' as never, ownedWeaponId: 'owned.fixture.a' as never }],
    },
  }
  plan.steps = [
    step,
    {
      ...structuredClone(step),
      id: 'step.fixture.b' as never,
      order: 2,
      executionEffects: { ...structuredClone(step.executionEffects), targetCompletions: [{ ...step.executionEffects.targetCompletions[0], buildListEntryId: 'build-list.fixture.b' as never }] },
    },
  ]
  plan.currentStepId = plan.steps[0].id
  return plan
}

describe('ProductionPlan lifecycle metadata', () => {
  it('accepts the draft Plan a Planner generates', () => {
    expect(issuePaths(currentPlan())).toEqual([])
  })

  it('requires the three lifecycle fields to be present', () => {
    const plan = currentPlan() as Partial<ProductionPlan>
    delete plan.completedAt
    expect(issuePaths(plan as ProductionPlan)).toContain('completedAt')
  })

  it('ties completedAt to completed and the abandonment fields to abandoned', () => {
    const completedWithoutTime = { ...currentPlan(), status: 'completed' as const, currentStepId: null }
    completedWithoutTime.steps = completedWithoutTime.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }))
    expect(issuePaths(completedWithoutTime)).toContain('completedAt')
    expect(issuePaths({ ...completedWithoutTime, completedAt: DOMAIN_FIXTURE_TIME })).toEqual([])

    const abandoned = { ...currentPlan(), status: 'abandoned' as const, abandonmentReason: 'user_abandoned' as const }
    expect(issuePaths(abandoned)).toContain('abandonedAt')
    expect(issuePaths({ ...abandoned, abandonedAt: DOMAIN_FIXTURE_TIME })).toEqual([])
    expect(issuePaths({ ...abandoned, abandonedAt: DOMAIN_FIXTURE_TIME, abandonmentReason: 'guessed' as never })).toContain('abandonmentReason')
    expect(issuePaths({ ...currentPlan(), status: 'active', abandonmentReason: 'replan_adopted', abandonedAt: DOMAIN_FIXTURE_TIME })).toEqual(
      expect.arrayContaining(['abandonmentReason', 'abandonedAt']),
    )
  })

  it('requires ordered Step progression of an Execution contract Plan', () => {
    const active = { ...currentPlan(), status: 'active' as const }
    expect(issuePaths(active)).toEqual([])
    // A completed Step after an incomplete one breaks the one-at-a-time order.
    const skipped = structuredClone(active)
    skipped.steps[1] = { ...skipped.steps[1], isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }
    expect(issuePaths(skipped)).toContain('steps')
    // An active Plan points at its first incomplete Step.
    const advanced = structuredClone(active)
    advanced.steps[0] = { ...advanced.steps[0], isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }
    expect(issuePaths(advanced)).toContain('currentStepId')
    expect(issuePaths({ ...advanced, currentStepId: advanced.steps[1].id })).toEqual([])
    // A draft has no completed Step, a completed Plan no incomplete one.
    expect(issuePaths({ ...advanced, status: 'draft', currentStepId: advanced.steps[1].id })).toEqual(
      expect.arrayContaining(['steps', 'currentStepId']),
    )
    expect(issuePaths({ ...advanced, status: 'completed', currentStepId: null, completedAt: DOMAIN_FIXTURE_TIME })).toContain('currentStepId')
  })
})

describe('ExecutionHistory actualResult', () => {
  const actual = (
    restorationBonuses: ReturnType<typeof createRestorationBonusSet> | null,
    restorationBonusScope: 'normal_artian' | null,
  ): ExecutionHistory => ({
    ...createValidExecutionHistory(),
    actualResult: {
      restorationBonuses,
      restorationBonusScope,
      seriesSkillId: null,
      groupSkillId: null,
      securedOwnedWeaponId: null,
      note: null,
    },
  })

  it('accepts restoration bonuses and scope that are both null or both present', () => {
    expect(validateExecutionHistory(actual(null, null)).issues).toEqual([])
    expect(validateExecutionHistory(actual(createRestorationBonusSet(), 'normal_artian')).issues).toEqual([])
  })

  it.each([
    ['slots without a scope', () => actual(createRestorationBonusSet(), null)],
    ['a scope without slots', () => actual(null, 'normal_artian')],
  ])('refuses %s', (_label, build) => {
    const result = validateExecutionHistory(build())
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: 'actualResult.restorationBonusScope',
      code: 'invalid_state',
    }))
  })
})

function actualResultDifferentHistory(): ExecutionHistory {
  return {
    ...createValidExecutionHistory(),
    action: 'actual_result_different',
    wasExpected: false,
    recalculationReason: 'unexpected_result',
    actualResult: {
      restorationBonuses: null,
      restorationBonusScope: null,
      seriesSkillId: 'series.fixture.a',
      groupSkillId: 'group.fixture.a',
      securedOwnedWeaponId: null,
      note: null,
    },
  }
}

function operationUncertainHistory(): ExecutionHistory {
  const history = createValidExecutionHistory()
  return {
    ...history,
    action: 'operation_uncertain',
    wasExpected: false,
    recalculationReason: 'execution_operation_uncertain',
    actualResult: null,
    undoSnapshot: { ...history.undoSnapshot, affectedOwnedWeaponsBefore: [] },
  }
}

describe('ExecutionHistory actualResult Skill IDs', () => {
  it.each(['seriesSkillId', 'groupSkillId'] as const)('refuses an empty non-null %s', (field) => {
    const history = actualResultDifferentHistory()
    history.actualResult = { ...history.actualResult!, [field]: '' }
    expect(validateExecutionHistory(history).issues).toContainEqual(
      expect.objectContaining({ path: `actualResult.${field}`, code: 'invalid_id' }),
    )
    history.actualResult = { ...history.actualResult, [field]: '   ' }
    expect(validateExecutionHistory(history).isValid).toBe(false)
  })

  it('accepts null Skill IDs and refuses a non-string note', () => {
    expect(validateExecutionHistory(createValidExecutionHistory()).issues).toEqual([])
    const history = actualResultDifferentHistory()
    history.actualResult = { ...history.actualResult!, note: 42 as never }
    expect(validateExecutionHistory(history).issues).toContainEqual(expect.objectContaining({ path: 'actualResult.note' }))
    expect(validateExecutionHistory({ ...actualResultDifferentHistory(), actualResult: { ...actualResultDifferentHistory().actualResult!, note: 'memo' } }).issues).toEqual([])
  })
})

describe('ExecutionHistory action records', () => {
  const paths = (history: ExecutionHistory) => validateExecutionHistory(history).issues.map(({ path }) => path)

  it('fixes confirmed_expected as an expected result without a reason', () => {
    expect(paths({ ...createValidExecutionHistory(), wasExpected: false, recalculationReason: 'unexpected_result' })).toEqual(
      expect.arrayContaining(['wasExpected', 'recalculationReason']),
    )
  })

  it('fixes actual_result_different as unexpected, with unexpected_result and an actual result', () => {
    expect(paths({ ...actualResultDifferentHistory(), wasExpected: true })).toContain('wasExpected')
    expect(paths({ ...actualResultDifferentHistory(), recalculationReason: 'execution_operation_uncertain' })).toContain('recalculationReason')
    expect(paths({ ...actualResultDifferentHistory(), actualResult: null })).toContain('actualResult')
    const secured = actualResultDifferentHistory()
    secured.actualResult = { ...secured.actualResult!, securedOwnedWeaponId: 'owned.fixture.a' as never }
    expect(paths(secured)).toContain('actualResult.securedOwnedWeaponId')
  })

  it('fixes operation_uncertain as unexpected, with its reason, no actual result and no entity change', () => {
    expect(paths({ ...operationUncertainHistory(), wasExpected: true })).toContain('wasExpected')
    expect(paths({ ...operationUncertainHistory(), recalculationReason: 'unexpected_result' })).toContain('recalculationReason')
    expect(paths({ ...operationUncertainHistory(), actualResult: actualResultDifferentHistory().actualResult })).toContain('actualResult')
    const changed = operationUncertainHistory()
    changed.undoSnapshot = { ...changed.undoSnapshot, affectedTargetWeaponsBefore: [createValidTargetWeapon()] }
    expect(paths(changed)).toContain('undoSnapshot')
  })

  it('keeps the legacy action records valid', () => {
    const legacy = {
      ...createValidExecutionHistory(),
      action: 'secured_weapon' as const,
      actualResult: { ...actualResultDifferentHistory().actualResult!, securedOwnedWeaponId: 'owned.fixture.a' as never },
    }
    expect(validateExecutionHistory(legacy).issues).toEqual([])
    expect(validateExecutionHistory({ ...createValidExecutionHistory(), action: 'skipped_candidate', wasExpected: false, recalculationReason: 'planned_candidate_not_secured' }).issues).toEqual([])
  })
})

describe('ExecutionHistory Undo snapshot', () => {
  it('accepts the current actions and the full snapshot', () => {
    for (const action of ['confirmed_expected', 'finished_as_compromise', 'secured_weapon', 'skipped_candidate'] as const) {
      expect(validateExecutionHistory({ ...createValidExecutionHistory(), action }).issues).toEqual([])
    }
    expect(validateExecutionHistory(actualResultDifferentHistory()).issues).toEqual([])
    expect(validateExecutionHistory(operationUncertainHistory()).issues).toEqual([])
    expect(validateExecutionHistory({ ...createValidExecutionHistory(), action: 'undo' as never }).isValid).toBe(false)
  })

  it.each(['affectedTargetWeaponsBefore', 'executionSavePointBefore'] as const)(
    'refuses a snapshot without %s instead of reading it as empty',
    (field) => {
      const history = createValidExecutionHistory()
      delete (history.undoSnapshot as Partial<ExecutionHistory['undoSnapshot']>)[field]
      expect(validateExecutionHistory(history).issues).toContainEqual(
        expect.objectContaining({ path: 'undoSnapshot', code: 'invalid_structure' }),
      )
    },
  )

  it('validates the Target and save point snapshots it carries', () => {
    const history = createValidExecutionHistory()
    history.undoSnapshot.affectedTargetWeaponsBefore = [createValidTargetWeapon(), createValidTargetWeapon()]
    expect(validateExecutionHistory(history).issues).toContainEqual(
      expect.objectContaining({ path: 'undoSnapshot.affectedTargetWeaponsBefore' }),
    )
    const foreign = createValidExecutionHistory()
    const otherPlan = { ...createValidProductionPlan(), id: 'plan.fixture.other' as ProductionPlan['id'] }
    foreign.undoSnapshot.executionSavePointBefore = {
      id: executionSavePointIdForPlan(otherPlan.id),
      productionPlanId: otherPlan.id,
      lastExecutionHistoryId: null,
      rngState: createValidRngState(),
      normalCounters: [createValidNormalArtianCounter()],
      ownedWeapons: [],
      targetWeapons: [],
      productionPlan: otherPlan,
      recordedAt: DOMAIN_FIXTURE_TIME,
    }
    expect(validateExecutionHistory(foreign).issues).toContainEqual(
      expect.objectContaining({ path: 'undoSnapshot.executionSavePointBefore.productionPlanId' }),
    )
  })
})

describe('Export schema 8 -> 9', () => {
  function schema8Plan(status: ProductionPlan['status'] = 'draft'): ProductionPlan {
    const plan = { ...createValidProductionPlan(), status } as Partial<ProductionPlan>
    delete plan.abandonmentReason
    delete plan.abandonedAt
    delete plan.completedAt
    delete plan.conflictRepairLineage
    return plan as ProductionPlan
  }

  /** A schema 8 RngState predates the schema 10 Identification provenance. */
  function schema8RngState(): RngState {
    const state = { ...createValidRngState(), schemaVersion: 1 } as unknown as Partial<RngState>
    delete state.lastIdentifiedAt
    return state as RngState
  }

  function schema8Root(overrides: Partial<ExportRootV8> = {}): ExportRootV8 {
    return {
      schemaVersion: 8,
      appName: 'mh-wilds-gogma-artian-planner',
      exportedAt: DOMAIN_FIXTURE_TIME,
      rngState: schema8RngState(),
      normalArtianCounters: [],
      ownedWeapons: [],
      targetWeapons: [],
      buildCandidates: [],
      buildListEntries: [],
      productionPlans: [schema8Plan()],
      executionHistory: [],
      executionSavePoints: [],
      settings: {
        id: 'settings', schemaVersion: 1, debugMode: false, resultPageSize: 50,
        defaultSearchLimit: 5000, createdAt: DOMAIN_FIXTURE_TIME, updatedAt: DOMAIN_FIXTURE_TIME,
      },
      ...overrides,
    }
  }

  it('gives non-terminal Plans their deterministic nulls, including a save point Plan', () => {
    const active = schema8Plan('active')
    const root = schema8Root({
      productionPlans: [schema8Plan('draft'), { ...active, id: 'plan.fixture.b' as ProductionPlan['id'] }],
      executionSavePoints: [{
        id: executionSavePointIdForPlan('plan.fixture.b' as ProductionPlan['id']),
        productionPlanId: 'plan.fixture.b' as ProductionPlan['id'],
        lastExecutionHistoryId: null,
        rngState: schema8RngState(),
        normalCounters: [],
        ownedWeapons: [],
        targetWeapons: [],
        productionPlan: { ...active, id: 'plan.fixture.b' as ProductionPlan['id'] },
        recordedAt: DOMAIN_FIXTURE_TIME,
      }],
    })
    const migrated = migrateExportRootV8ToV9(root)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(9)
    const nulls = { abandonmentReason: null, abandonedAt: null, completedAt: null }
    expect(migrated.root.productionPlans).toEqual(root.productionPlans.map((plan) => ({ ...plan, ...nulls })))
    expect(migrated.root.executionSavePoints[0].productionPlan).toEqual({ ...root.productionPlans[1], ...nulls })
    // The input is not mutated.
    expect(root.productionPlans[0]).not.toHaveProperty('completedAt')
    expect(prepareExportRootForImport(JSON.parse(JSON.stringify(root))).ok).toBe(true)
  })

  it.each(['completed', 'abandoned'] as const)('fails a %s Plan closed instead of guessing its metadata', (status) => {
    expect(migrateExportRootV8ToV9(schema8Root({ productionPlans: [schema8Plan(status)] })).ok).toBe(false)
  })

  it('fails a root with ExecutionHistory closed instead of inventing Undo state', () => {
    const history = createValidExecutionHistory() as unknown as Record<string, Record<string, unknown>>
    delete history.undoSnapshot.affectedTargetWeaponsBefore
    delete history.undoSnapshot.executionSavePointBefore
    const result = migrateExportRootV8ToV9(schema8Root({ executionHistory: [history as unknown as ExecutionHistory] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'executionHistory[0].undoSnapshot' }))
  })

  it('refuses a schema 8 Plan that already carries a lifecycle field', () => {
    expect(migrateExportRootV8ToV9(schema8Root({ productionPlans: [createValidProductionPlan()] })).ok).toBe(false)
  })
})
