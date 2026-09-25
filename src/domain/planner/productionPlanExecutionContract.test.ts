import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  createExpectedPlanState,
  createTargetExecutionStateHash,
  isCalculationContextCompatible,
  migrateExportRootV7ToV8,
  migrateExportRootV8ToV9,
  prepareExportRootForImport,
  resolveObservationBindingTokens,
  validateProductionPlan,
  type ExportRootV7,
} from '../models/publicTypes'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { createTargetDefinitionHash, withIntermediateStateSelection } from '../buildList'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  CONSTRAINED_START_NORMAL_COUNTER,
  CONSTRAINED_START_SKILL_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  gogmaWeapon,
  idealBonuses,
  normalWeapon,
  practicalBonuses,
} from '../../test/fixtures/constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationNormalCounters,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import {
  DOMAIN_FIXTURE_TIME,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import {
  collectProductionPlanDependentTargetWeaponIds,
  createDependentBuildListEntriesHash,
  createDependentTargetDefinitionsHash,
  createPlanningTargetWeaponsHash,
  createProductionPlan,
} from './productionPlanGeneration'
import {
  applyProductionPlanStartTargetLinks,
  deriveProductionPlanStartTargetLinks,
} from './productionPlanStartEffects'

const WEAPON_TYPE = 'weapon.fixture.a'
const NO_TARGETS = { targetWeapons: [], dependentTargetWeaponIds: [] }

function operationTypes(plan: ProductionPlan | null): string[] {
  return plan?.steps.map(({ operationType }) => operationType) ?? []
}

async function plan(built: ReturnType<typeof orchestrationScenario>): Promise<ProductionPlan> {
  const before = structuredClone(built.input)
  const result = await createProductionPlan(built.input, built.dependencies)
  expect(result.termination.status).toBe('completed')
  expect(result.plan).not.toBeNull()
  // Planner calculation never writes a Target preference, a status, a
  // protection or an in-progress state into its input.
  expect(built.input).toEqual(before)
  const validation = validateProductionPlan(result.plan as ProductionPlan)
  expect(validation.issues).toEqual([])
  return result.plan as ProductionPlan
}

/**
 * The first Step starts from the state after the Plan start effect, which
 * changes Target preferences only, and every Step starts where the previous one
 * ended (`docs/PLANNER_SPEC.md` 16.5).
 */
function expectChain(built: ProductionPlan) {
  const { targetExecutionStateHash: _first, ...firstRest } = built.steps[0].expectedStateBefore
  const { targetExecutionStateHash: _initial, ...initialRest } = built.baseSnapshot.initialExecutionState
  void _first
  void _initial
  expect(firstRest).toEqual(initialRest)
  built.steps.slice(0, -1).forEach((step, index) => {
    expect(step.expectedStateAfter).toEqual(built.steps[index + 1].expectedStateBefore)
  })
}

/** The dependent Target execution hash of the given Targets after the Plan start effect. */
function startedTargetHash(
  result: ProductionPlan,
  input: { targetWeapons: TargetWeapon[]; buildListEntries: BuildListEntry[] },
): string {
  return createTargetExecutionStateHash({
    targetWeapons: applyProductionPlanStartTargetLinks(
      input.targetWeapons,
      deriveProductionPlanStartTargetLinks(result.selectedBuildListEntryIds, input.buildListEntries),
    ),
    dependentTargetWeaponIds: collectProductionPlanDependentTargetWeaponIds(result, input.buildListEntries),
  })
}

function completionsOf(step: PlanStep | undefined) {
  return step?.executionEffects?.targetCompletions ?? []
}

describe('calculation schema version boundaries', () => {
  it('moves the calculation schema to 14 for the deterministic scheduler; Export and Dexie move only with persisted shapes', () => {
    // The Execution Plan contract moved the calculation schema to 12 and Export
    // to 8 without a Dexie upgrade; the Execution runtime lifecycle metadata then
    // moved Export to 9 and Dexie to 6 without touching calculation semantics.
    // The Plan start effect moved the Target link of existing weapons from the
    // first physical Step to the Plan start: a calculation change only. The
    // Identification provenance later moved Export to 10 and Dexie to 7, again
    // without touching calculation semantics. Issue #103 Phase C moved the
    // Production Planner to the deterministic scheduler: a calculation change
    // only (14), with no persisted shape change.
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
    expect(EXPORT_SCHEMA_VERSION).toBe(12)
    expect(DATABASE_SCHEMA_VERSION).toBe(9)
  })

  it.each([11, 12, 13])('fails a version %i Plan closed instead of reusing it as a current Plan', (version) => {
    const current = { ...createValidProductionPlan().calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    expect(isCalculationContextCompatible({ ...current, appSchemaVersion: version }, current)).toBe(false)
  })

  it('keeps a legacy Plan with an independent reserve Step valid as a historical record', () => {
    const legacy = createValidProductionPlan()
    legacy.calculationContext.appSchemaVersion = 11
    legacy.baseSnapshot.calculationContext.appSchemaVersion = 11
    legacy.steps[0].operationType = 'reserve_weapon'
    expect(validateProductionPlan(legacy).isValid).toBe(true)
  })

  it('refuses a current Plan that still carries a legacy Step or lacks the execution contract', () => {
    const current = createValidProductionPlan()
    current.calculationContext.appSchemaVersion = 12
    current.baseSnapshot.calculationContext.appSchemaVersion = 12
    const paths = validateProductionPlan(current).issues.map(({ path }) => path)
    expect(paths).toContain('steps[0].operationType')
    expect(paths).toContain('steps[0].executionEffects')
    expect(paths).toContain('baseSnapshot.dependentTargetDefinitionsHash')
    expect(paths).toContain('baseSnapshot.dependentBuildListEntriesHash')
    expect(paths).toContain('steps[0].expectedStateBefore.targetExecutionStateHash')
  })
})

describe('Target definition and planning-input hashes', () => {
  const target = () => createValidTargetWeapon()

  it.each([
    ['priority', (value: TargetWeapon) => { value.priority = 5 }],
    ['isEnabled', (value: TargetWeapon) => { value.isEnabled = false }],
    ['preferredOwnedWeaponId', (value: TargetWeapon) => { value.preferredOwnedWeaponId = ownedWeaponId('owned.preferred') }],
    ['lifecycle', (value: TargetWeapon) => { value.lifecycleStatus = 'completed'; value.completedAt = DOMAIN_FIXTURE_TIME }],
    ['name / memo', (value: TargetWeapon) => { value.name = 'renamed'; value.memo = 'changed' }],
  ])('leaves createTargetDefinitionHash unchanged for %s', (_label, mutate) => {
    const changed = target()
    mutate(changed)
    expect(createTargetDefinitionHash(changed)).toBe(createTargetDefinitionHash(target()))
  })

  it.each([
    ['Ideal', (value: TargetWeapon) => { value.idealBonuses[0] = { ...value.idealBonuses[0], bonusRankId: 'bonus_rank.fixture.low' } }],
    ['Practical', (value: TargetWeapon) => { value.practicalBonusConditions[0].requiredExCount = 1 }],
    ['Alternative', (value: TargetWeapon) => { value.alternativeBonusRules[0].maxReplacementCount = 2 }],
    ['Ideal Skill', (value: TargetWeapon) => { value.idealSkillCondition.matchMode = 'any' }],
    ['Practical Skill', (value: TargetWeapon) => { value.practicalSkillCondition.groupSkillId = null }],
  ])('changes createTargetDefinitionHash for a %s condition change', (_label, mutate) => {
    const changed = target()
    mutate(changed)
    expect(createTargetDefinitionHash(changed)).not.toBe(createTargetDefinitionHash(target()))
  })

  it.each([
    ['priority', (value: TargetWeapon) => { value.priority = 5 }],
    ['isEnabled', (value: TargetWeapon) => { value.isEnabled = false }],
    ['preferredOwnedWeaponId', (value: TargetWeapon) => { value.preferredOwnedWeaponId = ownedWeaponId('owned.preferred') }],
    ['lifecycle', (value: TargetWeapon) => { value.lifecycleStatus = 'completed'; value.completedAt = DOMAIN_FIXTURE_TIME }],
  ])('changes the planning targetWeaponsHash for %s', (_label, mutate) => {
    const changed = target()
    mutate(changed)
    expect(createPlanningTargetWeaponsHash([changed])).not.toBe(createPlanningTargetWeaponsHash([target()]))
  })

  it('leaves the planning targetWeaponsHash unchanged for name, memo and timestamps', () => {
    const changed = { ...target(), name: 'renamed', memo: 'changed', updatedAt: '2027-01-01T00:00:00.000Z' }
    expect(createPlanningTargetWeaponsHash([changed])).toBe(createPlanningTargetWeaponsHash([target()]))
  })
})

describe('Plan-dependent hashes', () => {
  const targetA = () => orchestrationTarget('target.dependent.a')
  const targetB = () => orchestrationTarget('target.dependent.b')
  const entryFor = (id: string, goal: TargetWeapon) =>
    orchestrationEntry(id, goal, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: ownedWeaponId(`owned.${id}`),
      operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: ownedWeaponId(`owned.${id}`), gogmaCounterBefore: 10, gogmaCounterAfter: 11 }],
    })

  it('ignores an added Target and changes only for a dependent Target priority or isEnabled', () => {
    const base = createDependentTargetDefinitionsHash([targetA()], [targetA().id])
    expect(createDependentTargetDefinitionsHash([targetA(), targetB()], [targetA().id])).toBe(base)
    expect(createDependentTargetDefinitionsHash([{ ...targetA(), priority: 5 }], [targetA().id])).not.toBe(base)
    expect(createDependentTargetDefinitionsHash([{ ...targetA(), isEnabled: false }], [targetA().id])).not.toBe(base)
    // Execution itself links and completes the Target, so these are verified by
    // the expected Target execution state instead.
    expect(createDependentTargetDefinitionsHash([{ ...targetA(), preferredOwnedWeaponId: ownedWeaponId('owned.x') }], [targetA().id])).toBe(base)
    expect(createDependentTargetDefinitionsHash([{ ...targetA(), lifecycleStatus: 'completed', completedAt: DOMAIN_FIXTURE_TIME }], [targetA().id])).toBe(base)
    expect(createDependentTargetDefinitionsHash([{ ...targetB(), priority: 5 }, targetA()], [targetA().id])).toBe(base)
  })

  it('ignores an added Entry and changes for a dependent Entry planning constraint', () => {
    const entryA = entryFor('entry.dependent.a', targetA())
    const base = createDependentBuildListEntriesHash([entryA], [entryA.id])
    expect(createDependentBuildListEntriesHash([entryA, entryFor('entry.dependent.b', targetB())], [entryA.id])).toBe(base)
    const preferenceChanged = withIntermediateStateSelection(entryA, {
      skillOpportunityId: null,
      bonusOpportunityId: null,
      improvementPreference: 'skill_first',
    })
    expect(createDependentBuildListEntriesHash([preferenceChanged], [entryA.id])).not.toBe(base)
  })

  it('hashes only the dependent Targets into the Target execution state', () => {
    const a = targetA()
    const input = { targetWeapons: [a], dependentTargetWeaponIds: [a.id] }
    const base = createTargetExecutionStateHash(input)
    expect(createTargetExecutionStateHash({ ...input, targetWeapons: [a, targetB()] })).toBe(base)
    expect(createTargetExecutionStateHash({ ...input, targetWeapons: [a, { ...targetB(), preferredOwnedWeaponId: ownedWeaponId('owned.y') }] })).toBe(base)
    expect(createTargetExecutionStateHash({ ...input, targetWeapons: [{ ...a, preferredOwnedWeaponId: ownedWeaponId('owned.x') }] })).not.toBe(base)
    const completed: TargetWeapon[] = [{ ...a, lifecycleStatus: 'completed', completedAt: DOMAIN_FIXTURE_TIME }]
    expect(createTargetExecutionStateHash({ ...input, targetWeapons: completed })).not.toBe(base)
    // Completion timestamps are not execution state.
    const retimed: TargetWeapon[] = [{ ...a, completedAt: '2027-01-01T00:00:00.000Z' }]
    expect(createTargetExecutionStateHash({ ...input, targetWeapons: retimed })).toBe(base)
  })
})

describe('ExpectedPlanState.ownedWeaponsHash', () => {
  const rng = createValidRngState()
  const hashOf = (weapon: OwnedWeapon) => createExpectedPlanState(rng, [], [weapon], NO_TARGETS).ownedWeaponsHash
  const base = createValidOwnedWeapon()

  it('ignores status and executionInProgress', () => {
    expect(hashOf({ ...base, status: 'ideal' })).toBe(hashOf(base))
    expect(hashOf({ ...base, executionInProgress: { productionPlanId: 'plan.x' as never, startedAt: DOMAIN_FIXTURE_TIME } })).toBe(hashOf(base))
  })

  it('moves for performance, protection, scope and kind', () => {
    expect(hashOf({ ...base, seriesSkillId: null })).not.toBe(hashOf(base))
    expect(hashOf({ ...base, isProtected: !base.isProtected })).not.toBe(hashOf(base))
    expect(hashOf({ ...base, restorationBonusScope: 'normal_artian' })).not.toBe(hashOf(base))
    const normal: OwnedNormalArtianWeapon = { ...base, kind: 'normal', rarity: 8, seriesSkillId: null, groupSkillId: null, status: null }
    expect(hashOf(normal)).not.toBe(hashOf({ ...base, seriesSkillId: null, groupSkillId: null }))
  })
})

describe('ProductionPlan execution projection', () => {
  function newNormalRoute(count: number): BuildRoute {
    return {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        { type: 'create_normal_artian', weaponTypeId: WEAPON_TYPE, rarity: 8, count, normalCounterBefore: CONSTRAINED_START_NORMAL_COUNTER, normalCounterAfter: CONSTRAINED_START_NORMAL_COUNTER + count },
        { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
        { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
      ],
    }
  }

  it('splits a count > 1 creation into Counter-advance Normals and one tracked production target', async () => {
    const goal = orchestrationTarget('target.projection.forge')
    const entry = orchestrationEntry('entry.projection.forge', goal, newNormalRoute(3))
    const built = orchestrationScenario({ targets: [goal], entries: [entry], normalCounters: orchestrationNormalCounters() })
    const result = await plan(built)

    expect(operationTypes(result)).toEqual([
      'create_normal_artian', 'create_normal_artian', 'create_normal_artian',
      'convert_normal_to_gogma', 'reset_bonuses',
    ])
    const [first, second, target, convert, reset] = result.steps
    for (const advance of [first, second]) {
      expect(advance.executionEffects).toEqual({
        trackedOwnedWeaponId: null,
        normalCreationRole: 'counter_advance',
        registersTrackedWeapon: false,
        observationBinding: null,
        targetLinks: [],
        compromiseLabels: [],
        targetCompletions: [],
      })
      expect(advance.ownedWeaponId).toBeNull()
      expect(advance.inventoryChange).toBeNull()
      // A Counter-advance Normal moves the Counter and registers nothing.
      expect(advance.rngAdvance.normalCounterDelta).toBe(1)
      expect(advance.expectedStateAfter.ownedWeaponsHash).toBe(advance.expectedStateBefore.ownedWeaponsHash)
      expect(advance.expectedStateAfter.normalCountersHash).not.toBe(advance.expectedStateBefore.normalCountersHash)
    }
    const tracked = target.executionEffects?.trackedOwnedWeaponId
    expect(tracked).toBe('owned.orchestration.created.1')
    expect(target.executionEffects).toMatchObject({
      normalCreationRole: 'production_target',
      registersTrackedWeapon: true,
      observationBinding: null,
      targetLinks: [{ buildListEntryId: entry.id, targetWeaponId: goal.id }],
    })
    expect(target.inventoryChange?.addOwnedWeapon).toMatchObject({
      id: tracked, kind: 'normal', rarity: 8, restorationBonusScope: 'normal_artian',
      restorationBonuses: practicalBonuses(), status: null, isProtected: false,
    })
    expect(target.expectedStateAfter.ownedWeaponsHash).not.toBe(target.expectedStateBefore.ownedWeaponsHash)
    // Linking the Target to the registered weapon is expected execution state.
    expect(target.expectedStateAfter.targetExecutionStateHash).not.toBe(target.expectedStateBefore.targetExecutionStateHash)
    expect(convert.ownedWeaponId).toBe(tracked)
    expect(convert.inventoryChange?.updateOwnedWeapons[0]).toMatchObject({ id: tracked, kind: 'gogma', status: 'unclassified' })
    expect(convert.executionEffects?.targetLinks).toEqual([])
    expect(reset.ownedWeaponId).toBe(tracked)
    expect(completionsOf(reset)).toEqual([{ buildListEntryId: entry.id, targetWeaponId: goal.id, ownedWeaponId: tracked }])
    expect(reset.inventoryChange?.updateOwnedWeapons[0]).toMatchObject({
      id: tracked, status: 'ideal', isProtected: true, executionInProgress: null,
      restorationBonuses: idealBonuses(), restorationBonusScope: 'gogma_artian',
    })
    expect(result.steps.some(({ operationType }) => operationType === 'reserve_weapon')).toBe(false)
    expectChain(result)
    expect(collectProductionPlanDependentTargetWeaponIds(result, built.input.buildListEntries)).toEqual([goal.id])
  })

  it('binds a blind production-target Normal to the user observation instead of fabricating slots', async () => {
    const goal = orchestrationTarget('target.projection.blind')
    const entry = orchestrationEntry('entry.projection.blind', goal, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        { type: 'create_normal_artian', weaponTypeId: WEAPON_TYPE, rarity: 8, count: 1, normalCounterBefore: null, normalCounterAfter: null },
        { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
        { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
      ],
    })
    const built = orchestrationScenario({ targets: [goal], entries: [entry] })
    const result = await plan(built)

    expect(operationTypes(result)).toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses'])
    const [create, convert, reset] = result.steps
    const tracked = create.executionEffects?.trackedOwnedWeaponId
    expect(create.executionEffects).toMatchObject({
      normalCreationRole: 'production_target',
      registersTrackedWeapon: true,
      observationBinding: { kind: 'normal_restoration_bonuses' },
    })
    // No predicted and no fabricated five slots anywhere.
    expect(create.expectedResult?.restorationBonuses).toBeNull()
    expect(create.inventoryChange?.addOwnedWeapon).toBeNull()
    expect(convert.inventoryChange?.updateOwnedWeapons).toEqual([])

    const observed = practicalBonuses()
    const different = idealBonuses()
    const registered = (slots: typeof observed): OwnedNormalArtianWeapon =>
      normalWeapon(tracked as string, { name: goal.name, restorationBonuses: slots })
    const binding = [{ ownedWeaponId: tracked as never, planStepId: create.id, observedRestorationBonuses: observed, observedRestorationBonusScope: 'normal_artian' as const }]
    const actualHash = (weapon: OwnedWeapon) =>
      createExpectedPlanState(built.input.rngState, [], [weapon], NO_TARGETS, resolveObservationBindingTokens([weapon], binding)).ownedWeaponsHash
    // The observed slots A bind to the token, so the expected chain holds ...
    expect(actualHash(registered(observed))).toBe(create.expectedStateAfter.ownedWeaponsHash)
    // ... while an unplanned edit to B is a mismatch.
    expect(actualHash(registered(different))).not.toBe(create.expectedStateAfter.ownedWeaponsHash)
    // Conversion carries the binding through; the Reset replaces the five slots
    // and ends it, so the completed weapon is fully predicted again.
    const converted: OwnedGogmaArtianWeapon = gogmaWeapon(tracked as string, {
      restorationBonuses: observed, restorationBonusScope: 'normal_artian',
      seriesSkillId: convert.expectedResult?.seriesSkillId ?? null, groupSkillId: convert.expectedResult?.groupSkillId ?? null,
    })
    expect(actualHash(converted)).toBe(convert.expectedStateAfter.ownedWeaponsHash)
    expect(reset.inventoryChange?.updateOwnedWeapons[0]).toMatchObject({ id: tracked, restorationBonuses: idealBonuses(), isProtected: true })
    expectChain(result)
  })

  it('keeps an owned Normal ID through conversion and completion', async () => {
    const goal = orchestrationTarget('target.projection.owned-normal')
    const source = normalWeapon('owned.projection.normal')
    const entry = orchestrationEntry('entry.projection.owned-normal', goal, {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [
        { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
        { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
      ],
    })
    const built = orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] })
    const result = await plan(built)

    expect(operationTypes(result)).toEqual(['convert_normal_to_gogma', 'reset_bonuses'])
    expect(result.steps.map(({ ownedWeaponId }) => ownedWeaponId)).toEqual([source.id, source.id])
    expect(result.steps[0].inventoryChange).toMatchObject({ addOwnedWeapon: null, removeOwnedWeaponIds: [] })
    expect(result.steps[0].inventoryChange?.updateOwnedWeapons[0]).toMatchObject({
      id: source.id, kind: 'gogma', status: 'unclassified', createdAt: source.createdAt,
    })
    // The owned Normal exists before the Plan starts, so the Plan start effect
    // links it; no Step carries the link (16.11).
    expect(result.steps.flatMap((step) => step.executionEffects?.targetLinks ?? [])).toEqual([])
    expect(deriveProductionPlanStartTargetLinks(result.selectedBuildListEntryIds, built.input.buildListEntries))
      .toEqual([{ buildListEntryId: entry.id, targetWeaponId: goal.id, ownedWeaponId: source.id }])
    expect(result.steps[0].expectedStateBefore.targetExecutionStateHash).toBe(startedTargetHash(result, built.input))
    expect(result.steps[0].expectedStateBefore.targetExecutionStateHash)
      .not.toBe(result.baseSnapshot.initialExecutionState.targetExecutionStateHash)
    expect(completionsOf(result.steps[1]).map(({ ownedWeaponId }) => ownedWeaponId)).toEqual([source.id])
    expectChain(result)
  })

  it('updates one existing Gogma in place and protects it at completion', async () => {
    const goal = orchestrationTarget('target.projection.gogma')
    const source = orchestrationSource('owned.projection.gogma')
    const entry = orchestrationEntry('entry.projection.gogma', goal, {
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: source.id,
      operations: [
        { type: 'reset_bonuses', sourceOwnedWeaponId: source.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
        { type: 'reset_skills', sourceOwnedWeaponId: source.id, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
      ],
    })
    const built = orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] })
    const result = await plan(built)

    expect(result.steps.map(({ ownedWeaponId }) => ownedWeaponId)).toEqual([source.id, source.id])
    expect(result.steps[0].executionEffects?.targetLinks).toEqual([])
    expect(result.steps[1].executionEffects?.targetLinks).toEqual([])
    expect(deriveProductionPlanStartTargetLinks(result.selectedBuildListEntryIds, built.input.buildListEntries))
      .toEqual([{ buildListEntryId: entry.id, targetWeaponId: goal.id, ownedWeaponId: source.id }])
    expect(result.steps[0].expectedStateBefore.targetExecutionStateHash).toBe(startedTargetHash(result, built.input))
    const last = result.steps[1]
    expect(completionsOf(last)).toEqual([{ buildListEntryId: entry.id, targetWeaponId: goal.id, ownedWeaponId: source.id }])
    // An existing weapon becomes protected at completion: a semantic change.
    expect(last.inventoryChange?.updateOwnedWeapons[0]).toMatchObject({ id: source.id, isProtected: true, status: 'ideal' })
    expect(last.expectedStateAfter.ownedWeaponsHash).not.toBe(last.expectedStateBefore.ownedWeaponsHash)
    expectChain(result)
  })

  it('confirms a zero-operation Ideal with one Counter-free confirm_owned_ideal Step', async () => {
    const goal = orchestrationTarget('target.projection.zero')
    // Protection does not prevent the confirmation: it changes no performance.
    const source = orchestrationSource('owned.projection.zero', {
      restorationBonuses: idealBonuses(), seriesSkillId: IDEAL_SERIES_SKILL_ID, isProtected: true,
    })
    const entry = orchestrationEntry('entry.projection.zero', goal, {
      kind: 'existing_gogma_current', sourceOwnedWeaponId: source.id, operations: [],
    })
    const built = orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] })
    const result = await plan(built)

    expect(operationTypes(result)).toEqual(['confirm_owned_ideal'])
    const [confirm] = result.steps
    expect(confirm.rngAdvance).toEqual({ gogmaCounterDelta: 0, skillCounterDelta: 0, normalCounterDelta: null, affectedNormalCounterId: null })
    expect(confirm.executionEffects).toEqual({
      trackedOwnedWeaponId: source.id,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: [{ buildListEntryId: entry.id, targetWeaponId: goal.id, ownedWeaponId: source.id }],
    })
    expect(confirm.expectedStateAfter.rngStateHash).toBe(confirm.expectedStateBefore.rngStateHash)
    expect(confirm.expectedStateAfter.normalCountersHash).toBe(confirm.expectedStateBefore.normalCountersHash)
    expect(confirm.expectedStateAfter.targetExecutionStateHash).not.toBe(confirm.expectedStateBefore.targetExecutionStateHash)
    expect(confirm.progressedTargetWeaponIds).toEqual([])
    expect(result.selectedBuildListEntryIds).toEqual([entry.id])
    expectChain(result)
  })

  it('projects a relink and a completion clearing across several Plan-dependent Targets', async () => {
    const shared = orchestrationSource('owned.projection.shared', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
    const other = orchestrationSource('owned.projection.other', { restorationBonuses: idealBonuses() })
    const goalA = orchestrationTarget('target.projection.multi.a')
    // Target B prefers the weapon Target A's Route starts from.
    const goalB = orchestrationTarget('target.projection.multi.b', { preferredOwnedWeaponId: shared.id })
    const entryA = orchestrationEntry('entry.projection.multi.a', goalA, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: shared.id,
      operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: shared.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 }],
    })
    const entryB = orchestrationEntry('entry.projection.multi.b', goalB, {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: other.id,
      operations: [{ type: 'reset_skills', sourceOwnedWeaponId: other.id, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 }],
    }, { finalBonuses: other.restorationBonuses })
    const goalC = orchestrationTarget('target.projection.multi.c')
    const built = orchestrationScenario({
      targets: [goalA, goalB, goalC],
      entries: [entryA, entryB],
      ownedWeapons: [shared, other],
    })
    built.input.buildListEntries = [entryA]
    const result = await plan(built)

    const dependent = collectProductionPlanDependentTargetWeaponIds(result, built.input.buildListEntries)
    // Only Target A's Route is in this Plan; Target B's preference is cleared by
    // Execution but B is not a dependency, so its clearing is not hashed, and
    // the unrelated Target C never is.
    expect(dependent).toEqual([goalA.id])
    const [reset] = result.steps
    // The Plan start effect links Target A to the shared weapon and releases
    // Target B; the Step itself links nothing.
    expect(reset.executionEffects?.targetLinks).toEqual([])
    expect(reset.expectedStateBefore.targetExecutionStateHash).toBe(
      createTargetExecutionStateHash({
        targetWeapons: [{ ...goalA, preferredOwnedWeaponId: shared.id }, { ...goalB, preferredOwnedWeaponId: null }, goalC],
        dependentTargetWeaponIds: dependent,
      }),
    )
    const afterTargets = [
      { ...goalA, lifecycleStatus: 'completed' as const, completedAt: DOMAIN_FIXTURE_TIME, preferredOwnedWeaponId: null },
      { ...goalB, preferredOwnedWeaponId: null },
      goalC,
    ]
    expect(reset.expectedStateAfter.targetExecutionStateHash).toBe(
      createTargetExecutionStateHash({ targetWeapons: afterTargets, dependentTargetWeaponIds: dependent }),
    )
    // Adding another Target does not move the Plan's initial execution state.
    const withAddedTarget = createExpectedPlanState(
      built.input.rngState, built.input.normalCounters, built.input.ownedWeapons,
      { targetWeapons: [...built.input.targetWeapons, orchestrationTarget('target.projection.multi.added')], dependentTargetWeaponIds: dependent },
    )
    expect(withAddedTarget).toEqual(result.baseSnapshot.initialExecutionState)
    expect(result.baseSnapshot.dependentTargetDefinitionsHash).toBe(
      createDependentTargetDefinitionsHash([...built.input.targetWeapons, orchestrationTarget('target.projection.multi.added')], dependent),
    )
    expect(result.baseSnapshot.dependentBuildListEntriesHash).toBe(
      createDependentBuildListEntriesHash([...built.input.buildListEntries, entryB], result.selectedBuildListEntryIds),
    )
  })

  it('projects both Targets of a two-Target Plan into its dependent execution state', async () => {
    const sourceA = orchestrationSource('owned.projection.two.a', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
    const sourceB = orchestrationSource('owned.projection.two.b', { restorationBonuses: idealBonuses() })
    const goalA = orchestrationTarget('target.projection.two.a')
    // Target B wants a different Series Skill, so Target A's completed weapon
    // never satisfies Target B on its own.
    const s8 = { seriesSkillId: 'series_skill.fixture.s8', groupSkillId: null, matchMode: 'all' as const }
    const goalB = orchestrationTarget('target.projection.two.b', {
      preferredOwnedWeaponId: sourceA.id,
      idealSkillCondition: s8,
      practicalSkillCondition: s8,
    })
    const entryA = orchestrationEntry('entry.projection.two.a', goalA, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: sourceA.id,
      operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: sourceA.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 }],
    })
    const entryB = orchestrationEntry('entry.projection.two.b', goalB, {
      kind: 'existing_gogma_reset_skills',
      sourceOwnedWeaponId: sourceB.id,
      operations: [
        { type: 'reset_skills', sourceOwnedWeaponId: sourceB.id, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
        { type: 'reset_skills', sourceOwnedWeaponId: sourceB.id, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER + 1, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 2 },
      ],
    }, { seriesSkillId: 'series_skill.fixture.s8' })
    const built = orchestrationScenario({ targets: [goalA, goalB], entries: [entryA, entryB], ownedWeapons: [sourceA, sourceB] })
    const result = await plan(built)

    const dependent = collectProductionPlanDependentTargetWeaponIds(result, built.input.buildListEntries)
    expect(dependent).toEqual([goalA.id, goalB.id].sort())
    expect(result.selectedBuildListEntryIds).toEqual([entryA.id, entryB.id].sort())
    expect(result.steps.flatMap((step) => completionsOf(step).map(({ targetWeaponId }) => targetWeaponId)).sort())
      .toEqual([goalA.id, goalB.id].sort())
    // The Plan start effect relinks sourceA from Target B to Target A and links
    // Target B to sourceB, both dependent Targets, so the first Step starts from
    // that state and no Step links anything.
    expect(result.steps.flatMap((step) => step.executionEffects?.targetLinks ?? [])).toEqual([])
    expect(result.steps[0].expectedStateBefore.targetExecutionStateHash).toBe(
      createTargetExecutionStateHash({
        targetWeapons: [
          { ...goalA, preferredOwnedWeaponId: sourceA.id },
          { ...goalB, preferredOwnedWeaponId: sourceB.id },
        ],
        dependentTargetWeaponIds: dependent,
      }),
    )
    expect(startedTargetHash(result, built.input)).toBe(result.steps[0].expectedStateBefore.targetExecutionStateHash)
    expectChain(result)
    const finalTargets = [
      { ...goalA, lifecycleStatus: 'completed' as const, completedAt: DOMAIN_FIXTURE_TIME, preferredOwnedWeaponId: null },
      { ...goalB, lifecycleStatus: 'completed' as const, completedAt: DOMAIN_FIXTURE_TIME, preferredOwnedWeaponId: null },
    ]
    expect(result.steps.at(-1)?.expectedStateAfter.targetExecutionStateHash).toBe(
      createTargetExecutionStateHash({ targetWeapons: finalTargets, dependentTargetWeaponIds: dependent }),
    )
  })
})

describe('Export schema 7 -> 8', () => {
  function schema7Root(plan: ProductionPlan): ExportRootV7 {
    return {
      schemaVersion: 7,
      appName: 'mh-wilds-gogma-artian-planner',
      exportedAt: DOMAIN_FIXTURE_TIME,
      // A schema 7 RngState predates the schema 10 Identification provenance.
      rngState: (() => {
        const state = { ...createValidRngState(), schemaVersion: 1 } as unknown as Record<string, unknown>
        delete state.lastIdentifiedAt
        return state as unknown as RngState
      })(),
      normalArtianCounters: [],
      ownedWeapons: [],
      targetWeapons: [],
      buildCandidates: [],
      buildListEntries: [] as BuildListEntry[],
      productionPlans: [plan],
      executionHistory: [],
      executionSavePoints: [],
      settings: {
        id: 'settings', schemaVersion: 1, debugMode: false, resultPageSize: 50,
        defaultSearchLimit: 5000, createdAt: DOMAIN_FIXTURE_TIME, updatedAt: DOMAIN_FIXTURE_TIME,
      },
    }
  }

  /** A Plan as a schema 7 Export stores it: before the lifecycle metadata. */
  function schema7Plan(): ProductionPlan {
    const plan = createValidProductionPlan() as Partial<ProductionPlan>
    delete plan.abandonmentReason
    delete plan.abandonedAt
    delete plan.completedAt
    return plan as ProductionPlan
  }

  it('changes only the version and keeps every legacy Plan exactly as persisted', () => {
    const legacy = schema7Plan()
    legacy.steps[0].operationType = 'reserve_weapon'
    const migrated = migrateExportRootV7ToV8(schema7Root(legacy))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(8)
    expect(migrated.root.productionPlans).toEqual([legacy])
    expect(migrated.root.productionPlans[0].steps[0].executionEffects).toBeUndefined()
    // Schema 8 -> 9 gives the draft Plan its deterministic lifecycle nulls ...
    const toV9 = migrateExportRootV8ToV9(migrated.root)
    expect(toV9.ok && toV9.root.productionPlans).toEqual([{ ...legacy, abandonmentReason: null, abandonedAt: null, completedAt: null }])
    // ... and schema 10 -> 11 then deletes it as an accumulated Draft of the old
    // contract, so the full Import chain reaches 11 without it.
    const imported = prepareExportRootForImport(JSON.parse(JSON.stringify(schema7Root(legacy))))
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.root.schemaVersion).toBe(12)
    expect(imported.root.productionPlans).toEqual([])
  })

  it('refuses a schema 7 root whose Plan already carries a schema 8 field', () => {
    const forged = schema7Plan()
    forged.steps[0].executionEffects = {
      trackedOwnedWeaponId: null, normalCreationRole: null, registersTrackedWeapon: false,
      observationBinding: null, targetLinks: [], compromiseLabels: [], targetCompletions: [],
    }
    expect(migrateExportRootV7ToV8(schema7Root(forged)).ok).toBe(false)
    const current = schema7Plan()
    current.calculationContext.appSchemaVersion = 12
    expect(migrateExportRootV7ToV8(schema7Root(current)).ok).toBe(false)
  })
})
