import { describe, expect, it } from 'vitest'
import {
  createExpectedPlanState,
  createOwnedWeapon,
  createReferencedOwnedWeaponsHash,
  createTargetWeapon,
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  EXPORT_SCHEMA_VERSION,
  executionSavePointIdForPlan,
  migrateExportRootV6ToV7,
  normalizeReferencedOwnedWeapon,
  prepareExportRootForImport,
  validateExecutionSavePoint,
  validateOwnedWeapon,
  validateTargetWeapon,
  type ExecutionSavePoint,
  type ExportRoot,
  type ExportRootV6,
  type OwnedWeapon,
  type ProductionPlanId,
  type TargetWeapon,
} from './publicTypes'
import { createTargetDefinitionHash } from '../buildList'
import { isTargetWeaponPlanningEligible } from './domainRules'
import {
  DOMAIN_FIXTURE_TIME,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  executionHistoryId,
  productionPlanId,
} from '../../test/fixtures/domainData'


/** A shallow copy without the named fields. */
function without<T extends object>(value: T, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>
  keys.forEach((key) => delete copy[key])
  return copy
}

const PLAN_ID = productionPlanId('plan.fixture.a')
const IN_PROGRESS = { productionPlanId: PLAN_ID, startedAt: DOMAIN_FIXTURE_TIME }

function completedTarget(
  completedByProductionPlanId: ProductionPlanId | null = PLAN_ID,
): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    lifecycleStatus: 'completed',
    completedAt: DOMAIN_FIXTURE_TIME,
    completedByProductionPlanId,
  }
}

function savePointFor(
  planId: ProductionPlanId = PLAN_ID,
  lastExecutionHistoryId: ExecutionSavePoint['lastExecutionHistoryId'] = null,
): ExecutionSavePoint {
  return {
    id: executionSavePointIdForPlan(planId),
    productionPlanId: planId,
    lastExecutionHistoryId,
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [{ ...createValidOwnedWeapon(), executionInProgress: IN_PROGRESS }],
    targetWeapons: [createValidTargetWeapon()],
    productionPlan: { ...createValidProductionPlan(), id: planId, status: 'active' },
    recordedAt: DOMAIN_FIXTURE_TIME,
  }
}

function exportRoot(overrides: Partial<ExportRoot> = {}): ExportRoot {
  const plan = createValidProductionPlan()
  return {
    schemaVersion: 10,
    appName: 'mh-wilds-gogma-artian-planner',
    exportedAt: DOMAIN_FIXTURE_TIME,
    rngState: createValidRngState(),
    normalArtianCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [{ ...createValidOwnedWeapon(), executionInProgress: IN_PROGRESS }],
    targetWeapons: [createValidTargetWeapon(), {
      ...completedTarget(null),
      id: 'target.fixture.completed' as TargetWeapon['id'],
    }],
    buildCandidates: [createValidBuildCandidate()],
    buildListEntries: [createValidBuildListEntry()],
    productionPlans: [plan],
    executionHistory: [createValidExecutionHistory()],
    executionSavePoints: [savePointFor(plan.id, executionHistoryId('history.fixture.a'))],
    settings: {
      id: 'settings',
      schemaVersion: 1,
      debugMode: false,
      resultPageSize: 50,
      defaultSearchLimit: 5000,
      createdAt: DOMAIN_FIXTURE_TIME,
      updatedAt: DOMAIN_FIXTURE_TIME,
    },
    ...overrides,
  }
}

function schema6Root(): ExportRootV6 {
  const root = exportRoot()
  return {
    ...without(root, ['executionSavePoints']),
    schemaVersion: 6,
    // A schema 6 RngState / Normal Counter predates the schema 10 Identification provenance.
    rngState: { ...without(root.rngState as never, ['lastIdentifiedAt']), schemaVersion: 1 },
    normalArtianCounters: root.normalArtianCounters.map((counter) => without(counter, ['lastIdentifiedAt'])),
    // No runtime before Export schema 9 wrote an ExecutionHistory, and one could
    // not carry the Undo snapshot schema 9 requires.
    executionHistory: [],
    // A schema 6 Plan predates the schema 9 lifecycle metadata.
    productionPlans: root.productionPlans.map((plan) =>
      without(plan, ['abandonmentReason', 'abandonedAt', 'completedAt'])),
    ownedWeapons: root.ownedWeapons.map((weapon) => without(weapon, ['executionInProgress'])),
    targetWeapons: [without(createValidTargetWeapon(), [
      'lifecycleStatus',
      'completedAt',
      'completedByProductionPlanId',
    ])],
  } as unknown as ExportRootV6
}

describe('Execution lifecycle version boundaries', () => {
  it('keeps the Export schema at or beyond 7 and the calculation schema at or beyond 11', () => {
    // The persistence foundation moved Export to 7 and left the calculation
    // schema at 11; the Execution Plan contract then moved them to 8 and 12,
    // and the Execution runtime lifecycle metadata moved Export to 9. The Plan
    // start effect moved the calculation schema to 13 with no persisted shape
    // change. The Identification provenance moved Export to 10.
    expect(EXPORT_SCHEMA_VERSION).toBe(10)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(13)
  })
})

describe('new record defaults', () => {
  it('creates a Target as active with no completion metadata', () => {
    const input = without(createValidTargetWeapon(), [
      'lifecycleStatus', 'completedAt', 'completedByProductionPlanId', 'createdAt', 'updatedAt',
    ]) as unknown as Parameters<typeof createTargetWeapon>[0]
    const target = createTargetWeapon(input, DOMAIN_FIXTURE_TIME)
    expect(target).toMatchObject({
      lifecycleStatus: 'active',
      completedAt: null,
      completedByProductionPlanId: null,
    })
    expect(validateTargetWeapon(target).isValid).toBe(true)
  })

  it('creates Normal and Gogma weapons with executionInProgress null', () => {
    const gogma = without(createValidOwnedWeapon(), [
      'executionInProgress', 'createdAt', 'updatedAt', 'isProtected',
    ]) as unknown as Omit<ReturnType<typeof createValidOwnedWeapon>, 'executionInProgress' | 'createdAt' | 'updatedAt' | 'isProtected'>
    expect(createOwnedWeapon(gogma, DOMAIN_FIXTURE_TIME).executionInProgress).toBeNull()
    const normal = createOwnedWeapon({
      ...gogma,
      kind: 'normal',
      rarity: 8,
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
    }, DOMAIN_FIXTURE_TIME)
    expect(normal.executionInProgress).toBeNull()
    expect(validateOwnedWeapon(normal).isValid).toBe(true)
  })
})

describe('TargetWeapon lifecycle validation', () => {
  it('accepts an active Target and both completion sources', () => {
    expect(validateTargetWeapon(createValidTargetWeapon()).isValid).toBe(true)
    expect(validateTargetWeapon(completedTarget(PLAN_ID)).isValid).toBe(true)
    // A user completion with an owned weapon carries no Plan.
    expect(validateTargetWeapon(completedTarget(null)).isValid).toBe(true)
  })

  it.each([
    ['an unknown lifecycle', { lifecycleStatus: 'archived' }, 'lifecycleStatus'],
    ['a missing lifecycle', { lifecycleStatus: undefined }, 'lifecycleStatus'],
    ['an active Target with completedAt', { completedAt: DOMAIN_FIXTURE_TIME }, 'completedAt'],
    ['an active Target with a completing Plan', { completedByProductionPlanId: PLAN_ID }, 'completedByProductionPlanId'],
  ])('rejects %s', (_label, fields, path) => {
    const target = { ...createValidTargetWeapon(), ...fields } as unknown as TargetWeapon
    expect(validateTargetWeapon(target).issues).toContainEqual(
      expect.objectContaining({ path }),
    )
  })

  it('rejects a completed Target without completedAt or still holding a preference', () => {
    expect(validateTargetWeapon({ ...completedTarget(), completedAt: null }).issues)
      .toContainEqual(expect.objectContaining({ path: 'completedAt' }))
    expect(validateTargetWeapon({
      ...completedTarget(),
      preferredOwnedWeaponId: createValidOwnedWeapon().id,
    }).issues).toContainEqual(expect.objectContaining({ path: 'preferredOwnedWeaponId' }))
  })

  it('treats only an enabled active Target as a planning target', () => {
    expect(isTargetWeaponPlanningEligible(createValidTargetWeapon())).toBe(true)
    expect(isTargetWeaponPlanningEligible({ ...createValidTargetWeapon(), isEnabled: false })).toBe(false)
    expect(isTargetWeaponPlanningEligible(completedTarget())).toBe(false)
  })
})

describe('OwnedWeapon executionInProgress validation', () => {
  it('accepts null and a Plan-bound record', () => {
    expect(validateOwnedWeapon(createValidOwnedWeapon()).isValid).toBe(true)
    expect(validateOwnedWeapon({ ...createValidOwnedWeapon(), executionInProgress: IN_PROGRESS }).isValid).toBe(true)
  })

  it.each([
    ['missing', undefined, 'executionInProgress'],
    ['a string', 'plan.fixture.a', 'executionInProgress'],
    ['without a Plan', { productionPlanId: '', startedAt: DOMAIN_FIXTURE_TIME }, 'executionInProgress.productionPlanId'],
    ['without a start time', { productionPlanId: PLAN_ID, startedAt: '' }, 'executionInProgress.startedAt'],
  ])('rejects an executionInProgress that is %s', (_label, value, path) => {
    const weapon = { ...createValidOwnedWeapon(), executionInProgress: value } as unknown as OwnedWeapon
    expect(validateOwnedWeapon(weapon).issues).toContainEqual(expect.objectContaining({ path }))
  })
})

describe('executionInProgress stays out of every semantic identity', () => {
  const weapon = createValidOwnedWeapon()
  const inProgress: OwnedWeapon = { ...weapon, executionInProgress: IN_PROGRESS }

  it('does not move referencedOwnedWeaponsHash or its per-weapon normalization', () => {
    const candidate = createValidBuildCandidate()
    const route = {
      ...candidate.route,
      kind: 'existing_gogma_reset_skills' as const,
      sourceOwnedWeaponId: weapon.id,
      operations: [{
        type: 'reset_skills' as const,
        sourceOwnedWeaponId: weapon.id,
        skillCounterBefore: 1,
        skillCounterAfter: 2,
      }],
    }
    expect(createReferencedOwnedWeaponsHash(route, [inProgress]))
      .toBe(createReferencedOwnedWeaponsHash(route, [weapon]))
    expect(normalizeReferencedOwnedWeapon(inProgress)).toEqual(normalizeReferencedOwnedWeapon(weapon))
    // Protection is still semantic.
    expect(createReferencedOwnedWeaponsHash(route, [{ ...weapon, isProtected: false }]))
      .not.toBe(createReferencedOwnedWeaponsHash(route, [weapon]))
  })

  it('does not move ExpectedPlanState.ownedWeaponsHash', () => {
    const rng = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    expect(createExpectedPlanState(rng, counters, [inProgress], { targetWeapons: [], dependentTargetWeaponIds: [] }))
      .toEqual(createExpectedPlanState(rng, counters, [weapon], { targetWeapons: [], dependentTargetWeaponIds: [] }))
  })

  it('leaves createTargetDefinitionHash untouched by lifecycle', () => {
    // Calculation schema 12 normalizes the hash to the performance definition
    // only, so neither lifecycle nor priority moves it (PLANNER_SPEC 16.11).
    const target = createValidTargetWeapon()
    expect(createTargetDefinitionHash(completedTarget(PLAN_ID)))
      .toBe(createTargetDefinitionHash(target))
    expect(createTargetDefinitionHash({ ...target, priority: 5 }))
      .toBe(createTargetDefinitionHash(target))
  })
})

describe('ExecutionSavePoint validation', () => {
  it('accepts a save point whose ID is derived from its Plan', () => {
    expect(validateExecutionSavePoint(savePointFor()).isValid).toBe(true)
  })

  it('rejects a non-derived ID, a foreign snapshot Plan, and invalid snapshot entities', () => {
    expect(validateExecutionSavePoint({ ...savePointFor(), id: 'save-point.random' }).issues)
      .toContainEqual(expect.objectContaining({ path: 'id' }))
    expect(validateExecutionSavePoint({
      ...savePointFor(),
      productionPlan: { ...createValidProductionPlan(), id: productionPlanId('plan.other') },
    }).issues).toContainEqual(expect.objectContaining({ path: 'productionPlan.id' }))
    const brokenWeapon = { ...createValidOwnedWeapon() } as Record<string, unknown>
    delete brokenWeapon.executionInProgress
    expect(validateExecutionSavePoint({
      ...savePointFor(),
      ownedWeapons: [brokenWeapon as unknown as OwnedWeapon],
    }).issues).toContainEqual(expect.objectContaining({ path: 'ownedWeapons[0].executionInProgress' }))
    expect(validateExecutionSavePoint({
      ...savePointFor(),
      targetWeapons: [{ ...createValidTargetWeapon(), lifecycleStatus: 'unknown' } as unknown as TargetWeapon],
    }).issues).toContainEqual(expect.objectContaining({ path: 'targetWeapons[0].lifecycleStatus' }))
  })
})

describe('Export schema 10', () => {
  it('round-trips save points, Target lifecycle, and executionInProgress through JSON', () => {
    const root = exportRoot()
    const parsed: unknown = JSON.parse(JSON.stringify(root))
    const imported = prepareExportRootForImport(parsed)
    expect(imported).toEqual({ ok: true, root })
    if (!imported.ok) return
    expect(imported.root.executionSavePoints).toEqual(root.executionSavePoints)
    expect(imported.root.targetWeapons[1].lifecycleStatus).toBe('completed')
    expect(imported.root.ownedWeapons[0].executionInProgress).toEqual(IN_PROGRESS)
  })

  it('migrates schema 6 with deterministic defaults and leaves artifacts untouched', () => {
    const legacy = schema6Root()
    const migrated = migrateExportRootV6ToV7(legacy)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.root.schemaVersion).toBe(7)
    const imported = prepareExportRootForImport(JSON.parse(JSON.stringify(legacy)))
    expect(imported.ok && imported.root.schemaVersion).toBe(10)
    expect(migrated.root.executionSavePoints).toEqual([])
    migrated.root.targetWeapons.forEach((target) => {
      expect(target).toMatchObject({ lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null })
    })
    migrated.root.ownedWeapons.forEach((weapon) => {
      expect(weapon.executionInProgress).toBeNull()
    })
    expect(migrated.root.buildCandidates).toEqual(legacy.buildCandidates)
    expect(migrated.root.buildListEntries).toEqual(legacy.buildListEntries)
    expect(migrated.root.productionPlans).toEqual(legacy.productionPlans)
    expect(migrated.root.executionHistory).toEqual(legacy.executionHistory)
    // The input is not mutated.
    expect(legacy.schemaVersion).toBe(6)
    expect(prepareExportRootForImport(JSON.parse(JSON.stringify(legacy))).ok).toBe(true)
  })

  it('refuses a schema 6 record that already carries a schema 7 field', () => {
    const legacy = schema6Root()
    const withLifecycle = {
      ...legacy,
      targetWeapons: [{ ...legacy.targetWeapons[0], lifecycleStatus: 'completed' }],
    } as unknown as ExportRootV6
    expect(migrateExportRootV6ToV7(withLifecycle).ok).toBe(false)
    const withSavePoints = { ...legacy, executionSavePoints: [] } as unknown as ExportRootV6
    expect(prepareExportRootForImport(withSavePoints).ok).toBe(false)
  })

  it('refuses unsupported schema versions and malformed roots', () => {
    expect(prepareExportRootForImport({ ...exportRoot(), schemaVersion: 5 }).ok).toBe(false)
    expect(prepareExportRootForImport({ ...exportRoot(), schemaVersion: 11 }).ok).toBe(false)
    expect(prepareExportRootForImport({ ...exportRoot(), appName: 'other' }).ok).toBe(false)
    expect(prepareExportRootForImport({ ...exportRoot(), ownedWeapons: null }).ok).toBe(false)
    expect(prepareExportRootForImport(null).ok).toBe(false)
    expect(prepareExportRootForImport({ ...exportRoot(), executionSavePoints: undefined }).ok).toBe(false)
  })

  // Import input is untrusted: a malformed element must come back as an
  // invalid_structure issue from an ordinary call, never as an exception.
  const expectStructureFailure = (
    run: () => ReturnType<typeof prepareExportRootForImport>,
    path: string,
  ) => {
    let result: ReturnType<typeof prepareExportRootForImport> | undefined
    expect(() => { result = run() }).not.toThrow()
    expect(result?.ok).toBe(false)
    if (!result || result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({ path, code: 'invalid_structure' }))
  }

  it.each([
    ['ownedWeapons: [null]', { ownedWeapons: [null] }, 'ownedWeapons[0]'],
    ['targetWeapons: [123]', { targetWeapons: [123] }, 'targetWeapons[0]'],
    ['ownedWeapons: [[]]', { ownedWeapons: [[]] }, 'ownedWeapons[0]'],
    ['targetWeapons: ["invalid"]', { targetWeapons: ['invalid'] }, 'targetWeapons[0]'],
  ])('fails schema 6 %s closed without throwing', (_label, fields, path) => {
    const malformed = { ...schema6Root(), ...fields } as unknown as ExportRootV6
    // The exported migration itself ...
    expectStructureFailure(
      () => migrateExportRootV6ToV7(malformed) as unknown as ReturnType<typeof prepareExportRootForImport>,
      path,
    )
    // ... and the Import preparation that routes schema 6 through it.
    expectStructureFailure(
      () => prepareExportRootForImport(JSON.parse(JSON.stringify(malformed))),
      path,
    )
  })

  it.each([
    ['ownedWeapons: [null]', { ownedWeapons: [null] }, 'ownedWeapons[0]'],
    ['targetWeapons: [null]', { targetWeapons: [null] }, 'targetWeapons[0]'],
    ['executionSavePoints: [null]', { executionSavePoints: [null] }, 'executionSavePoints[0]'],
    ['executionSavePoints: [123]', { executionSavePoints: [123] }, 'executionSavePoints[0]'],
    ['productionPlans: [null]', { productionPlans: [null] }, 'productionPlans[0]'],
    ['executionHistory: ["x"]', { executionHistory: ['x'] }, 'executionHistory[0]'],
  ])('fails schema 9 %s closed without throwing', (_label, fields, path) => {
    const malformed = { ...exportRoot(), ...fields }
    expectStructureFailure(() => prepareExportRootForImport(malformed), path)
  })

  it('fails malformed save point snapshots and nested entities closed without throwing', () => {
    const nullWeapon = { ...savePointFor(), ownedWeapons: [null] }
    expectStructureFailure(
      () => prepareExportRootForImport(exportRoot({
        executionSavePoints: [nullWeapon as unknown as ExecutionSavePoint],
      })),
      'executionSavePoints[0].ownedWeapons[0]',
    )
    const noPlan = { ...savePointFor(), productionPlan: null }
    expectStructureFailure(
      () => prepareExportRootForImport(exportRoot({
        executionSavePoints: [noPlan as unknown as ExecutionSavePoint],
      })),
      'executionSavePoints[0].productionPlan',
    )
    // An object element whose nested field has the wrong type reaches the
    // typed validator, which must still not escape as an exception.
    const brokenBonuses = { ...createValidOwnedWeapon(), executionInProgress: null, restorationBonuses: null }
    expectStructureFailure(
      () => prepareExportRootForImport(exportRoot({
        ownedWeapons: [brokenBonuses as unknown as OwnedWeapon],
      })),
      'ownedWeapons[0]',
    )
  })

  it('refuses a save point that references a missing Plan', () => {
    const result = prepareExportRootForImport(exportRoot({
      executionSavePoints: [savePointFor(productionPlanId('plan.fixture.missing'))],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: 'executionSavePoints[0].productionPlanId',
      code: 'invalid_reference',
    }))
  })

  it('refuses a save point whose last history is missing or belongs to another Plan', () => {
    const missing = prepareExportRootForImport(exportRoot({
      executionSavePoints: [savePointFor(PLAN_ID, executionHistoryId('history.fixture.missing'))],
    }))
    expect(missing.ok).toBe(false)

    const otherPlan = { ...createValidProductionPlan(), id: productionPlanId('plan.fixture.other') }
    const foreign = prepareExportRootForImport(exportRoot({
      productionPlans: [createValidProductionPlan(), otherPlan],
      executionSavePoints: [savePointFor(otherPlan.id, executionHistoryId('history.fixture.a'))],
    }))
    expect(foreign.ok).toBe(false)
    if (foreign.ok) return
    expect(foreign.issues).toContainEqual(expect.objectContaining({
      path: 'executionSavePoints[0].lastExecutionHistoryId',
    }))
  })

  it('refuses two save points for one Plan', () => {
    const result = prepareExportRootForImport(exportRoot({
      executionSavePoints: [savePointFor(), savePointFor()],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: 'executionSavePoints[1].productionPlanId',
      code: 'invalid_state',
    }))
  })

  it('refuses an ExecutionHistory whose actual slots carry no scope without throwing', () => {
    const history = createValidExecutionHistory()
    history.actualResult = {
      restorationBonuses: createValidOwnedWeapon().restorationBonuses,
      restorationBonusScope: null,
      seriesSkillId: null,
      groupSkillId: null,
      securedOwnedWeaponId: null,
      note: null,
    }
    let result: ReturnType<typeof prepareExportRootForImport> | undefined
    expect(() => {
      result = prepareExportRootForImport(JSON.parse(JSON.stringify(exportRoot({ executionHistory: [history] }))))
    }).not.toThrow()
    expect(result?.ok).toBe(false)
    if (!result || result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: 'executionHistory[0].actualResult.restorationBonusScope',
      code: 'invalid_state',
    }))
  })

  it('refuses an invalid Target lifecycle or executionInProgress', () => {
    expect(prepareExportRootForImport(exportRoot({
      targetWeapons: [{ ...createValidTargetWeapon(), completedAt: DOMAIN_FIXTURE_TIME }],
    })).ok).toBe(false)
    expect(prepareExportRootForImport(exportRoot({
      ownedWeapons: [{ ...createValidOwnedWeapon(), executionInProgress: 'yes' } as unknown as OwnedWeapon],
    })).ok).toBe(false)
  })
})
