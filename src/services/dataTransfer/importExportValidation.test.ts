import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  ExportRoot,
  OwnedWeapon,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { isProductionAvailableBonus } from '../../domain/artian/productionBonusAvailability'
import {
  DOMAIN_FIXTURE_TIME,
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidTargetWeapon,
  executionHistoryId,
  ownedWeaponId,
  productionPlanId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  DATA_TRANSFER_PLAN_ID,
  completedFixtureTarget,
  dataTransferMaster,
  dataTransferRoot,
  dataTransferSettings,
  fixtureSavePoint,
} from '../../test/fixtures/dataTransfer'
import {
  validateExportRootForFullReplacement,
  validateExportRootMasterReferences,
} from './importExportValidation'

const master = dataTransferMaster()

function validate(root: ExportRoot) {
  return validateExportRootForFullReplacement(root, master)
}

function expectRejected(root: ExportRoot, path: string | RegExp, code?: string) {
  const result = validate(root)
  expect(result.isValid).toBe(false)
  const matching = result.issues.filter((issue) =>
    typeof path === 'string' ? issue.path === path : path.test(issue.path))
  expect(matching.length, JSON.stringify(result.issues)).toBeGreaterThan(0)
  if (code) expect(matching.map((issue) => issue.code)).toContain(code)
}

function realMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

describe('validateExportRootForFullReplacement', () => {
  it('accepts a complete current-schema root carrying every Execution lifecycle state', () => {
    expect(validate(dataTransferRoot()).issues).toEqual([])
  })

  it('accepts a root whose calculation artifacts carry a historical CalculationContext', () => {
    const root = dataTransferRoot()
    // The Domain fixtures are calculation schema 1 artifacts under a fixture
    // engine version; Import keeps them and leaves staleness to the runtime.
    expect(root.buildCandidates[0].calculationContext.appSchemaVersion).toBe(1)
    expect(root.productionPlans[0].calculationContext.rngEngineVersion).toBe('fixture-only')
    expect(validate(root).isValid).toBe(true)
  })

  it('accepts a BuildListEntry whose source BuildCandidate record no longer exists', () => {
    const root = dataTransferRoot({ buildCandidates: [] })
    expect(root.buildListEntries[0].candidateId).toBe('candidate.fixture.a')
    expect(validate(root).issues).toEqual([])
  })

  it('accepts an empty root with no RngState', () => {
    const root = dataTransferRoot({
      rngState: null,
      normalArtianCounters: [],
      ownedWeapons: [],
      targetWeapons: [],
      buildCandidates: [],
      buildListEntries: [],
      productionPlans: [],
      executionHistory: [],
      executionSavePoints: [],
    })
    expect(validate(root).issues).toEqual([])
  })

  describe('malformed input never throws', () => {
    it.each<[string, (root: Record<string, unknown>) => void]>([
      ['a null candidate', (root) => { root.buildCandidates = [null] }],
      ['a string snapshot', (root) => { (root.buildListEntries as Record<string, unknown>[])[0].candidateSnapshot = 'snapshot' }],
      ['a numeric Undo snapshot', (root) => { (root.executionHistory as Record<string, unknown>[])[0].undoSnapshot = 5 }],
      ['a string Ideal bonus set', (root) => { (root.targetWeapons as Record<string, unknown>[])[0].idealBonuses = 'bonuses' }],
      ['settings as an array', (root) => { root.settings = [] }],
      ['a string route', (root) => { (root.buildCandidates as Record<string, unknown>[])[0].route = 'route' }],
      ['plan steps as an object', (root) => { (root.productionPlans as Record<string, unknown>[])[0].steps = {} }],
      ['a save point without a snapshot plan', (root) => { (root.executionSavePoints as Record<string, unknown>[])[0].productionPlan = null }],
    ])('fails closed on %s', (_label, mutate) => {
      const root = dataTransferRoot() as unknown as Record<string, unknown>
      mutate(root)
      const result = validate(root as unknown as ExportRoot)
      expect(result.isValid).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
    })

    it('fails closed on a non-object root', () => {
      expect(validate(null as unknown as ExportRoot).isValid).toBe(false)
      expect(validate([] as unknown as ExportRoot).isValid).toBe(false)
    })
  })

  describe('entity validation', () => {
    it.each<[string, (root: ExportRoot) => void, string | RegExp]>([
      ['RngState', (root) => { (root.rngState as { schemaVersion: number }).schemaVersion = 1 }, 'rngState.schemaVersion'],
      ['NormalArtianCounter', (root) => { root.normalArtianCounters[0].counter = -1 }, 'normalArtianCounters[0].counter'],
      ['OwnedWeapon', (root) => { (root.ownedWeapons[0] as { kind: string }).kind = 'unknown' }, 'ownedWeapons[0].kind'],
      ['TargetWeapon', (root) => { (root.targetWeapons[0] as { priority: number }).priority = 9 }, 'targetWeapons[0].priority'],
      ['BuildCandidate', (root) => { (root.buildCandidates[0].finalBonuses as unknown[]).pop() }, 'buildCandidates[0].finalBonuses'],
      ['BuildListEntry', (root) => { root.buildListEntries[0].candidateId = candidateId('candidate.other') }, 'buildListEntries[0].candidateId'],
      ['ProductionPlan', (root) => { (root.productionPlans[0] as { status: string }).status = 'paused' }, 'productionPlans[0].status'],
      ['ExecutionHistory', (root) => { (root.executionHistory[0] as { action: string }).action = 'guessed' }, 'executionHistory[0].action'],
      ['ExecutionSavePoint', (root) => { root.executionSavePoints[0].id = 'save-point.other' }, 'executionSavePoints[0].id'],
      ['AppSettings', (root) => { (root.settings as { schemaVersion: number }).schemaVersion = 2 }, 'settings.schemaVersion'],
    ])('rejects an invalid %s', (_entity, mutate, path) => {
      const root = dataTransferRoot()
      mutate(root)
      expectRejected(root, path)
    })
  })

  describe('primary ID uniqueness', () => {
    it.each<[string, (root: ExportRoot) => void, string]>([
      ['OwnedWeapon', (root) => { root.ownedWeapons.push({ ...root.ownedWeapons[0] }) }, 'ownedWeapons[1].id'],
      ['TargetWeapon', (root) => { root.targetWeapons.push({ ...root.targetWeapons[0] }) }, 'targetWeapons[2].id'],
      ['BuildCandidate', (root) => { root.buildCandidates.push({ ...root.buildCandidates[0] }) }, 'buildCandidates[1].id'],
      ['BuildListEntry', (root) => { root.buildListEntries.push({ ...root.buildListEntries[0] }) }, 'buildListEntries[1].id'],
      ['ProductionPlan', (root) => { root.productionPlans.push({ ...root.productionPlans[0] }) }, 'productionPlans[2].id'],
      ['ExecutionHistory', (root) => { root.executionHistory.push({ ...root.executionHistory[0] }) }, 'executionHistory[1].id'],
      ['NormalArtianCounter', (root) => { root.normalArtianCounters.push({ ...root.normalArtianCounters[0] }) }, 'normalArtianCounters[1].id'],
      ['ExecutionSavePoint', (root) => { root.executionSavePoints.push({ ...root.executionSavePoints[0] }) }, 'executionSavePoints[1].id'],
    ])('rejects a duplicate %s ID', (_entity, mutate, path) => {
      const root = dataTransferRoot()
      mutate(root)
      expectRejected(root, path, 'invalid_id')
    })
  })

  describe('persisted references', () => {
    it.each<[string, (root: ExportRoot) => void, string]>([
      ['BuildCandidate -> missing Target', (root) => { root.buildCandidates[0].targetWeaponId = targetWeaponId('target.missing') }, 'buildCandidates[0].targetWeaponId'],
      ['BuildListEntry -> missing Target', (root) => {
        root.buildListEntries[0].targetWeaponId = targetWeaponId('target.missing')
        root.buildListEntries[0].candidateSnapshot.targetWeaponId = targetWeaponId('target.missing')
      }, 'buildListEntries[0].targetWeaponId'],
      ['Candidate route -> missing source OwnedWeapon', (root) => {
        root.buildCandidates[0].route = {
          kind: 'existing_gogma_reset_skills',
          sourceOwnedWeaponId: ownedWeaponId('owned.missing'),
          operations: [{ type: 'reset_skills', sourceOwnedWeaponId: ownedWeaponId('owned.missing'), skillCounterBefore: 7, skillCounterAfter: 8 }],
        }
        root.buildCandidates[0].referencedOwnedWeaponsHash = 'hash.fixture.referenced'
      }, 'buildCandidates[0].route'],
      ['Entry snapshot route -> missing source OwnedWeapon', (root) => {
        const snapshot = root.buildListEntries[0].candidateSnapshot
        snapshot.route = {
          kind: 'existing_gogma_reset_bonuses',
          sourceOwnedWeaponId: ownedWeaponId('owned.missing'),
          operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: ownedWeaponId('owned.missing'), gogmaCounterBefore: 10, gogmaCounterAfter: 11 }],
        }
        snapshot.restorationBonusScope = 'gogma_artian'
        snapshot.referencedOwnedWeaponsHash = 'hash.fixture.referenced'
        root.buildListEntries[0].referencedOwnedWeaponsHash = 'hash.fixture.referenced'
      }, 'buildListEntries[0].candidateSnapshot.route'],
      ['Target preference -> missing OwnedWeapon', (root) => { root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.missing') }, 'targetWeapons[0].preferredOwnedWeaponId'],
      ['Plan -> missing selected BuildListEntry', (root) => { root.productionPlans[0].selectedBuildListEntryIds = [buildListEntryId('entry.missing')] }, 'productionPlans[0].selectedBuildListEntryIds[0]'],
      ['ExecutionHistory -> missing Plan', (root) => {
        root.executionHistory[0].planId = productionPlanId('plan.missing')
        root.executionHistory[0].undoSnapshot.productionPlanBefore.id = productionPlanId('plan.missing')
        root.executionHistory[0].undoSnapshot.executionSavePointBefore = null
        root.executionSavePoints = []
      }, 'executionHistory[0].planId'],
      ['ExecutionHistory -> missing PlanStep', (root) => { root.executionHistory[0].planStepId = 'step.missing' as never }, 'executionHistory[0].planStepId'],
      ['executionInProgress -> missing Plan', (root) => {
        root.ownedWeapons[0].executionInProgress = { productionPlanId: productionPlanId('plan.missing'), startedAt: DOMAIN_FIXTURE_TIME }
      }, 'ownedWeapons[0].executionInProgress.productionPlanId'],
      ['completedByProductionPlanId -> missing Plan', (root) => {
        root.targetWeapons[1] = completedFixtureTarget('target.fixture.completed', productionPlanId('plan.missing'))
      }, 'targetWeapons[1].completedByProductionPlanId'],
      ['SavePoint -> missing Plan', (root) => {
        root.executionSavePoints = [fixtureSavePoint(productionPlanId('plan.missing'), null)]
      }, 'executionSavePoints[0].productionPlanId'],
      ['SavePoint -> missing History', (root) => {
        root.executionSavePoints[0].lastExecutionHistoryId = executionHistoryId('history.missing')
      }, 'executionSavePoints[0].lastExecutionHistoryId'],
    ])('rejects %s', (_label, mutate, path) => {
      const root = dataTransferRoot()
      mutate(root)
      expectRejected(root, path, 'invalid_reference')
    })

    it('never reads a Plan-registered future OwnedWeapon ID or an Undo snapshot body as a current reference', () => {
      const root = dataTransferRoot()
      const plan = root.productionPlans[0]
      // The Execution registers this weapon at its creation Step; it does not
      // exist in the OwnedWeapon table before that Step is confirmed.
      plan.steps[0].ownedWeaponId = ownedWeaponId('owned.planned.future')
      plan.steps[0].inventoryChange = {
        addOwnedWeapon: { ...createValidOwnedWeapon(ownedWeaponId('owned.planned.future')), isProtected: false },
        removeOwnedWeaponIds: [ownedWeaponId('owned.planned.removed')],
        updateOwnedWeapons: [],
        materialRequirements: [],
      }
      // The Undo snapshot keeps a weapon that was deleted afterwards.
      root.executionHistory[0].undoSnapshot.removedOwnedWeaponsBefore = [createValidOwnedWeapon(ownedWeaponId('owned.deleted.past'))]
      root.executionHistory[0].undoSnapshot.addedOwnedWeaponIds = [ownedWeaponId('owned.added.past')]
      expect(validate(root).issues).toEqual([])
    })
  })

  describe('Target preference collection contract', () => {
    function secondWeapon(overrides: Partial<OwnedWeapon> = {}): OwnedWeapon {
      return { ...createValidOwnedWeapon(ownedWeaponId('owned.fixture.b')), isProtected: false, ...overrides } as OwnedWeapon
    }

    it('rejects the same weapon preferred by two Targets', () => {
      const root = dataTransferRoot()
      const second: TargetWeapon = { ...createValidTargetWeapon(), id: targetWeaponId('target.fixture.b') }
      root.targetWeapons = [root.targetWeapons[0], second]
      root.targetWeapons[0].preferredOwnedWeaponId = root.ownedWeapons[0].id
      second.preferredOwnedWeaponId = root.ownedWeapons[0].id
      expectRejected(root, 'targetWeapons[1].preferredOwnedWeaponId', 'invalid_reference')
    })

    it('rejects a protected preferred weapon', () => {
      const root = dataTransferRoot()
      root.ownedWeapons.push(secondWeapon({ isProtected: true }))
      root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.b')
      expectRejected(root, 'targetWeapons[0].preferredOwnedWeaponId', 'invalid_state')
    })

    it('rejects a weapon type mismatch', () => {
      const root = dataTransferRoot()
      root.ownedWeapons.push(secondWeapon({ weaponTypeId: 'weapon.fixture.b' }))
      root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.b')
      expectRejected(root, 'targetWeapons[0].preferredOwnedWeaponId', 'invalid_state')
    })

    it('rejects an element mismatch', () => {
      const root = dataTransferRoot()
      root.ownedWeapons.push(secondWeapon({ elementId: 'element.fixture.b' }))
      root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.b')
      expectRejected(root, 'targetWeapons[0].preferredOwnedWeaponId', 'invalid_state')
    })

    it('accepts a compatible unprotected preferred weapon', () => {
      const root = dataTransferRoot()
      root.ownedWeapons.push(secondWeapon())
      root.targetWeapons[0].preferredOwnedWeaponId = ownedWeaponId('owned.fixture.b')
      expect(validate(root).issues).toEqual([])
    })
  })

  it('rejects a Target whose Ideal does not satisfy its Practical condition', () => {
    const root = dataTransferRoot()
    root.targetWeapons[0].practicalBonusConditions[0].minimumRankId = 'bonus_rank.fixture.special'
    expectRejected(root, 'targetWeapons[0].practicalBonusConditions[0]')
  })

  describe('Master ID existence', () => {
    it.each<[string, (root: ExportRoot) => void, string]>([
      ['weaponTypeId', (root) => { root.ownedWeapons[0].weaponTypeId = 'weapon.unknown' }, 'ownedWeapons[0].weaponTypeId'],
      ['elementId', (root) => { root.targetWeapons[0].elementId = 'element.unknown' }, 'targetWeapons[0].elementId'],
      ['bonusTypeId', (root) => { root.ownedWeapons[0].restorationBonuses[2].bonusTypeId = 'bonus_type.unknown' }, 'ownedWeapons[0].restorationBonuses[2].bonusTypeId'],
      ['bonusRankId', (root) => { root.buildCandidates[0].finalBonuses[4].bonusRankId = 'bonus_rank.unknown' }, 'buildCandidates[0].finalBonuses[4].bonusRankId'],
      ['seriesSkillId', (root) => { root.ownedWeapons[0].seriesSkillId = 'series_skill.unknown' }, 'ownedWeapons[0].seriesSkillId'],
      ['groupSkillId', (root) => { root.ownedWeapons[0].groupSkillId = 'group_skill.unknown' }, 'ownedWeapons[0].groupSkillId'],
      ['materialId', (root) => { root.buildCandidates[0].requiredMaterials[0].materialId = 'material.unknown' }, 'buildCandidates[0].requiredMaterials[0].materialId'],
      ['a Normal Counter weaponTypeId', (root) => {
        root.normalArtianCounters[0].weaponTypeId = 'weapon.unknown'
        root.normalArtianCounters[0].id = 'weapon.unknown:8'
      }, 'normalArtianCounters[0].weaponTypeId'],
      ['a Target practical condition rank', (root) => { root.targetWeapons[0].practicalBonusConditions[1].minimumRankId = 'bonus_rank.unknown' }, 'targetWeapons[0].practicalBonusConditions[1].minimumRankId'],
      ['a Target alternative option type', (root) => { root.targetWeapons[0].alternativeBonusRules[0].options[0].alternativeBonusTypeId = 'bonus_type.unknown' }, 'targetWeapons[0].alternativeBonusRules[0].options[0].alternativeBonusTypeId'],
      ['a Target practical Skill', (root) => { root.targetWeapons[0].practicalSkillCondition.groupSkillId = 'group_skill.unknown' }, 'targetWeapons[0].practicalSkillCondition.groupSkillId'],
      ['an Entry snapshot conversion weapon type', (root) => {
        const operation = root.buildListEntries[0].candidateSnapshot.route.operations[1]
        if (operation.type === 'convert_normal_to_gogma') operation.weaponTypeId = 'weapon.unknown'
      }, 'buildListEntries[0].candidateSnapshot.route.operations[1].weaponTypeId'],
      ['a PlanStep expected result Skill', (root) => {
        const expected = root.productionPlans[0].steps[0].expectedResult
        if (expected) expected.seriesSkillId = 'series_skill.unknown'
      }, 'productionPlans[0].steps[0].expectedResult.seriesSkillId'],
      ['an Undo snapshot weapon bonus', (root) => {
        root.executionHistory[0].undoSnapshot.affectedOwnedWeaponsBefore[0].restorationBonuses[0].bonusRankId = 'bonus_rank.unknown'
      }, 'executionHistory[0].undoSnapshot.affectedOwnedWeaponsBefore[0].restorationBonuses[0].bonusRankId'],
      ['a save point Target element', (root) => {
        root.executionSavePoints[0].targetWeapons[0].elementId = 'element.unknown'
      }, 'executionSavePoints[0].targetWeapons[0].elementId'],
      ['an ExecutionHistory actual result bonus', (root) => {
        root.executionHistory[0].actualResult = {
          restorationBonuses: [
            { bonusTypeId: 'bonus_type.unknown', bonusRankId: 'bonus_rank.fixture.high' },
            { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
            { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
            { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
            { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
          ],
          restorationBonusScope: 'gogma_artian',
          seriesSkillId: null,
          groupSkillId: null,
          securedOwnedWeaponId: null,
          note: null,
        }
        ;(root.executionHistory[0] as { action: string }).action = 'actual_result_different'
        root.executionHistory[0].wasExpected = false
        root.executionHistory[0].recalculationReason = 'unexpected_result'
      }, 'executionHistory[0].actualResult.restorationBonuses[0].bonusTypeId'],
    ])('rejects an unknown %s', (_label, mutate, path) => {
      const root = dataTransferRoot()
      mutate(root)
      expectRejected(root, path, 'invalid_reference')
    })

    it('checks existence against the Master collections only, never a naming rule', () => {
      const root = dataTransferRoot()
      const oddMaster = dataTransferMaster()
      oddMaster.seriesSkills.push({ id: 'not-a-skill-looking-id', displayNameJa: 'x', displayNameEn: 'x', sortOrder: 99, isEnabled: false })
      root.ownedWeapons[0].seriesSkillId = 'not-a-skill-looking-id'
      root.executionSavePoints[0].ownedWeapons[0].seriesSkillId = 'not-a-skill-looking-id'
      expect(validateExportRootMasterReferences(root, oddMaster).issues).toEqual([])
      expect(validateExportRootMasterReferences(root, master).isValid).toBe(false)
    })
  })

  describe('Production availability is not an Import condition (DATA_MODEL 7.1)', () => {
    const real = realMaster()
    const bowPoisonBonuses: RestorationBonusSet = [
      { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
      { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' },
    ]

    function bowPoisonRoot(): ExportRoot {
      const weapon: OwnedWeapon = {
        ...createValidOwnedWeapon(ownedWeaponId('owned.bow.poison')),
        weaponTypeId: 'weapon.bow',
        elementId: 'element.poison',
        restorationBonuses: bowPoisonBonuses,
        restorationBonusScope: 'gogma_artian',
        seriesSkillId: 'series_skill.verified_01',
        groupSkillId: 'group_skill.verified_01',
        isProtected: false,
      }
      const target: TargetWeapon = {
        ...createValidTargetWeapon(),
        id: targetWeaponId('target.bow.poison'),
        weaponTypeId: 'weapon.bow',
        elementId: 'element.poison',
        idealBonuses: structuredClone(bowPoisonBonuses),
        practicalBonusConditions: [],
        alternativeBonusRules: [],
        idealSkillCondition: { seriesSkillId: 'series_skill.verified_01', groupSkillId: null, matchMode: 'all' },
        practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
      }
      return dataTransferRoot({
        rngState: null,
        normalArtianCounters: [],
        ownedWeapons: [weapon],
        targetWeapons: [target],
        buildCandidates: [],
        buildListEntries: [],
        productionPlans: [],
        executionHistory: [],
        executionSavePoints: [],
        settings: dataTransferSettings(),
      })
    }

    it('accepts a Bow / Poison Element bonus that exists in Master but is outside the Production lottery', () => {
      // The premise of the regression: Master knows the ID, Production does not draw it.
      expect(isProductionAvailableBonus(real, 'weapon.bow', 'element.poison', 'gogma_artian', bowPoisonBonuses[0])).toBe(false)
      const root = bowPoisonRoot()
      const before = structuredClone(root)
      expect(validateExportRootForFullReplacement(root, real).issues).toEqual([])
      // Validation is pure: nothing was normalized, removed or replaced.
      expect(root).toEqual(before)
    })

    it('still rejects a Bow weapon naming a bonus rank Master does not have', () => {
      const root = bowPoisonRoot()
      root.ownedWeapons[0].restorationBonuses[0].bonusRankId = 'bonus_rank.v'
      const result = validateExportRootForFullReplacement(root, real)
      expect(result.issues.map((issue) => issue.path)).toContain('ownedWeapons[0].restorationBonuses[0].bonusRankId')
    })
  })

  it('keeps the schema 10 literal as the only accepted root version', () => {
    const root = dataTransferRoot()
    ;(root as { schemaVersion: number }).schemaVersion = 9
    expectRejected(root, 'schemaVersion')
  })

  it('reports every phase-two issue together once the records are structurally valid', () => {
    const root = dataTransferRoot()
    root.buildCandidates.push({ ...createValidBuildCandidate(), targetWeaponId: targetWeaponId('target.missing') })
    root.ownedWeapons[0].groupSkillId = 'group_skill.unknown'
    const paths = validate(root).issues.map((issue) => issue.path)
    expect(paths).toContain('buildCandidates[1].id')
    expect(paths).toContain('buildCandidates[1].targetWeaponId')
    expect(paths).toContain('ownedWeapons[0].groupSkillId')
  })

  it('does not require the source OwnedWeapon of a snapshot Route to still be a Normal or unprotected', () => {
    // After Execution converted the owned Normal in place, or after the user
    // protected the source, the Entry is `owned_weapon_changed` stale - not an
    // invalid backup.
    const root = dataTransferRoot()
    const source = { ...createValidOwnedWeapon(ownedWeaponId('owned.fixture.converted')), isProtected: true }
    root.ownedWeapons.push(source)
    const entry = createValidBuildListEntry()
    entry.id = buildListEntryId('build-list.fixture.converted')
    entry.candidateId = candidateId('candidate.fixture.converted')
    entry.candidateSnapshot.id = entry.candidateId
    entry.candidateSnapshot.route = {
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [
        { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 7, skillCounterAfter: 8 },
        { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 11 },
      ],
    }
    entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    entry.candidateSnapshot.referencedOwnedWeaponsHash = 'hash.fixture.referenced'
    entry.candidateSnapshot.estimatedGogmaAdvance = 1
    entry.referencedOwnedWeaponsHash = 'hash.fixture.referenced'
    entry.isStale = true
    entry.staleReasons = ['owned_weapon_changed']
    root.buildListEntries.push(entry)
    expect(validate(root).issues).toEqual([])
  })

  describe('ProductionPlan BuildListEntry / TargetWeapon references', () => {
    const ENTRY = buildListEntryId('build-list.fixture.a')
    const TARGET = targetWeaponId('target.fixture.a')
    const OTHER_TARGET = targetWeaponId('target.fixture.completed')
    const MISSING_ENTRY = buildListEntryId('entry.missing')
    const MISSING_TARGET = targetWeaponId('target.missing')

    /** Each reference category of a Plan, set to the given Entry / Target pair. */
    const categories: [string, (root: ExportRoot, entry: typeof ENTRY, target: typeof TARGET) => void, string][] = [
      ['selectedBuildListEntryIds', (root, entry) => { root.productionPlans[0].selectedBuildListEntryIds = [entry] }, 'productionPlans[0].selectedBuildListEntryIds[0]'],
      ['steps[*].buildListEntryId / targetWeaponId', (root, entry, target) => {
        root.productionPlans[0].steps[0].buildListEntryId = entry
        root.productionPlans[0].steps[0].targetWeaponId = target
      }, 'productionPlans[0].steps[0].buildListEntryId'],
      ['steps[*].progressedTargetWeaponIds', (root, _entry, target) => { root.productionPlans[0].steps[0].progressedTargetWeaponIds = [target] }, 'productionPlans[0].dependentTargetWeaponIds'],
      ['steps[*].checkpointMilestones[*]', (root, entry, target) => {
        root.productionPlans[0].steps[0].checkpointMilestones = [{
          buildListEntryId: entry,
          targetWeaponId: target,
          skillOpportunityId: null,
          bonusOpportunityId: null,
          conditionMatch: { bonus: 'practical', skill: 'ideal' },
          remainingOperationCount: 1,
        }]
      }, 'productionPlans[0].steps[0].checkpointMilestones[0].buildListEntryId'],
      ['steps[*].executionEffects.targetLinks[*]', (root, entry, target) => {
        root.productionPlans[0].steps[0].ownedWeaponId = ownedWeaponId('owned.fixture.a')
        root.productionPlans[0].steps[0].executionEffects = effects({ targetLinks: [{ buildListEntryId: entry, targetWeaponId: target }] })
      }, 'productionPlans[0].steps[0].executionEffects.targetLinks[0].buildListEntryId'],
      ['steps[*].executionEffects.compromiseLabels[*]', (root, entry) => {
        root.productionPlans[0].steps[0].ownedWeaponId = ownedWeaponId('owned.fixture.a')
        root.productionPlans[0].steps[0].executionEffects = effects({ compromiseLabels: [{ buildListEntryId: entry, ownedWeaponId: ownedWeaponId('owned.fixture.a') }] })
      }, 'productionPlans[0].steps[0].executionEffects.compromiseLabels[0].buildListEntryId'],
      ['steps[*].executionEffects.targetCompletions[*]', (root, entry, target) => {
        root.productionPlans[0].steps[0].ownedWeaponId = ownedWeaponId('owned.fixture.a')
        root.productionPlans[0].steps[0].executionEffects = effects({ targetCompletions: [{ buildListEntryId: entry, targetWeaponId: target, ownedWeaponId: ownedWeaponId('owned.fixture.a') }] })
      }, 'productionPlans[0].steps[0].executionEffects.targetCompletions[0].buildListEntryId'],
      ['conflicts[*].buildListEntryIds', (root, entry) => { root.productionPlans[0].conflicts = [conflict({ buildListEntryIds: [entry] })] }, 'productionPlans[0].conflicts[0].buildListEntryIds[0]'],
      ['conflicts[*].recommendedBuildListEntryId', (root, entry) => { root.productionPlans[0].conflicts = [conflict({ recommendedBuildListEntryId: entry })] }, 'productionPlans[0].conflicts[0].recommendedBuildListEntryId'],
      ['conflicts[*].selectedBuildListEntryId', (root, entry) => { root.productionPlans[0].conflicts = [conflict({ selectedBuildListEntryId: entry })] }, 'productionPlans[0].conflicts[0].selectedBuildListEntryId'],
      ['conflicts[*].checkpointParticipants[*]', (root, entry) => {
        root.productionPlans[0].conflicts = [conflict({ checkpointParticipants: [{ buildListEntryId: entry, axis: 'skill', opportunityId: 'opportunity.fixture' as never }] })]
      }, 'productionPlans[0].conflicts[0].checkpointParticipants[0].buildListEntryId'],
      ['rejectedBuildListEntries[*]', (root, entry) => {
        root.productionPlans[0].rejectedBuildListEntries = [{ buildListEntryId: entry, reason: 'counter_before_current' as never, detail: 'fixture' }]
      }, 'productionPlans[0].rejectedBuildListEntries[0].buildListEntryId'],
    ]

    function effects(overrides: Partial<NonNullable<ExportRoot['productionPlans'][number]['steps'][number]['executionEffects']>>) {
      return {
        trackedOwnedWeaponId: ownedWeaponId('owned.fixture.a'),
        normalCreationRole: null,
        registersTrackedWeapon: false,
        observationBinding: null,
        targetLinks: [],
        compromiseLabels: [],
        targetCompletions: [],
        ...overrides,
      }
    }

    function conflict(overrides: Partial<ExportRoot['productionPlans'][number]['conflicts'][number]>) {
      return {
        id: 'conflict.fixture',
        kind: 'gogma_counter_position' as never,
        buildListEntryIds: [ENTRY],
        reason: 'fixture',
        recommendedBuildListEntryId: null,
        selectedBuildListEntryId: null,
        resolutionNote: null,
        ...overrides,
      }
    }

    /** The abandoned fixture Plan shares the Step; keep the run to one Plan under test. */
    function planRoot(): ExportRoot {
      const root = dataTransferRoot()
      root.productionPlans = [root.productionPlans[0]]
      root.executionSavePoints[0].productionPlan = { ...root.productionPlans[0] }
      root.executionHistory[0].undoSnapshot.productionPlanBefore = { ...root.productionPlans[0] }
      return root
    }

    it.each(categories)('accepts a valid %s reference', (_label, mutate) => {
      const root = planRoot()
      mutate(root, ENTRY, TARGET)
      expect(validate(root).issues).toEqual([])
    })

    it.each(categories.filter(([label]) => !label.includes('progressedTargetWeaponIds')))('rejects a missing BuildListEntry in %s', (_label, mutate, path) => {
      const root = planRoot()
      mutate(root, MISSING_ENTRY, TARGET)
      expectRejected(root, path, 'invalid_reference')
    })

    it.each<[string, (root: ExportRoot) => void, string]>([
      ['steps[*].targetWeaponId', (root) => { root.productionPlans[0].steps[0].targetWeaponId = MISSING_TARGET; root.productionPlans[0].steps[0].buildListEntryId = null }, 'productionPlans[0].dependentTargetWeaponIds'],
      ['steps[*].progressedTargetWeaponIds', (root) => { root.productionPlans[0].steps[0].progressedTargetWeaponIds = [MISSING_TARGET] }, 'productionPlans[0].dependentTargetWeaponIds'],
      ['steps[*].checkpointMilestones[*].targetWeaponId', (root) => { categories[3][1](root, ENTRY, MISSING_TARGET) }, 'productionPlans[0].steps[0].checkpointMilestones[0].targetWeaponId'],
      ['steps[*].executionEffects.targetLinks[*].targetWeaponId', (root) => { categories[4][1](root, ENTRY, MISSING_TARGET) }, 'productionPlans[0].dependentTargetWeaponIds'],
      ['steps[*].executionEffects.targetCompletions[*].targetWeaponId', (root) => { categories[6][1](root, ENTRY, MISSING_TARGET) }, 'productionPlans[0].dependentTargetWeaponIds'],
    ])('rejects a missing TargetWeapon in %s', (_label, mutate, path) => {
      const root = planRoot()
      mutate(root)
      expectRejected(root, path, 'invalid_reference')
    })

    it.each<[string, number]>([
      ['steps[*].targetWeaponId', 1],
      ['steps[*].checkpointMilestones[*]', 3],
      ['steps[*].executionEffects.targetLinks[*]', 4],
      ['steps[*].executionEffects.targetCompletions[*]', 6],
    ])('rejects %s naming an existing Target that is not the Entry own Target', (_label, categoryIndex) => {
      const root = planRoot()
      categories[categoryIndex][1](root, ENTRY, OTHER_TARGET)
      expectRejected(root, categories[categoryIndex][2], 'inconsistent_snapshot')
    })

    it('never reads a Step candidateId or ownedWeaponId as a current foreign key', () => {
      const root = planRoot()
      root.productionPlans[0].steps[0].candidateId = candidateId('candidate.replaced')
      root.productionPlans[0].steps[0].ownedWeaponId = ownedWeaponId('owned.planned.future')
      root.buildCandidates = []
      expect(validate(root).issues).toEqual([])
    })

    it('accepts a Plan-independent Target being absent from the Plan', () => {
      const root = planRoot()
      root.targetWeapons.push({ ...createValidTargetWeapon(), id: targetWeaponId('target.independent') })
      expect(validate(root).issues).toEqual([])
    })
  })

  describe('running Plan collection invariant', () => {
    function plans(root: ExportRoot, statuses: ('draft' | 'active' | 'stale' | 'completed' | 'abandoned')[]) {
      root.executionSavePoints = []
      root.executionHistory = []
      root.ownedWeapons[0].executionInProgress = null
      root.targetWeapons[1] = completedFixtureTarget('target.fixture.completed', null)
      root.productionPlans = statuses.map((status, index) => ({
        ...createValidProductionPlan(),
        id: productionPlanId(`plan.fixture.${index}`),
        status,
        abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
        abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
        completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
        currentStepId: status === 'completed' ? null : 'step.fixture.a' as never,
        steps: status === 'completed'
          ? [{ ...createValidProductionPlan().steps[0], isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }]
          : createValidProductionPlan().steps,
      }))
    }

    it.each<[string, ('draft' | 'active' | 'stale' | 'completed' | 'abandoned')[]]>([
      ['one active Plan', ['active']],
      ['one stale Plan', ['stale']],
      ['several terminal Plans beside one active Plan', ['completed', 'abandoned', 'completed', 'active', 'abandoned']],
      ['several draft Plans', ['draft', 'draft', 'active']],
      ['no running Plan', ['draft', 'completed', 'abandoned']],
    ])('accepts %s', (_label, statuses) => {
      const root = dataTransferRoot()
      plans(root, statuses)
      expect(validate(root).issues).toEqual([])
    })

    it.each<[string, ('active' | 'stale')[], string]>([
      ['active + stale', ['active', 'stale'], 'productionPlans[1].status'],
      ['two active Plans', ['active', 'active'], 'productionPlans[1].status'],
      ['two stale Plans', ['stale', 'stale'], 'productionPlans[1].status'],
    ])('rejects %s', (_label, statuses, path) => {
      const root = dataTransferRoot()
      plans(root, statuses)
      expectRejected(root, path, 'invalid_state')
    })

    it('counts only the top-level collection, never the Plans inside an Undo snapshot or a save point', () => {
      // The fixture already holds an active snapshot Plan in its save point and
      // in its Undo snapshot beside the one running top-level Plan.
      const root = dataTransferRoot()
      expect(root.executionSavePoints[0].productionPlan.status).toBe('active')
      expect(root.executionHistory[0].undoSnapshot.productionPlanBefore.status).toBe('active')
      expect(validate(root).issues).toEqual([])
    })
  })

  describe('executionInProgress and save point Plan lifecycle', () => {
    function withPlanStatus(status: 'draft' | 'active' | 'stale' | 'completed' | 'abandoned'): ExportRoot {
      const root = dataTransferRoot()
      const plan = root.productionPlans[0]
      plan.status = status
      plan.abandonmentReason = status === 'abandoned' ? 'user_abandoned' : null
      plan.abandonedAt = status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null
      plan.completedAt = status === 'completed' ? DOMAIN_FIXTURE_TIME : null
      if (status === 'completed') {
        plan.currentStepId = null
        plan.steps = [{ ...plan.steps[0], isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }]
      }
      // The history and the save point of the fixture belong to this Plan; the
      // save point is dropped here so the in-progress rule is judged alone.
      root.executionHistory[0].undoSnapshot.productionPlanBefore = { ...plan }
      root.executionSavePoints = []
      return root
    }

    it.each(['active', 'stale'] as const)('accepts executionInProgress naming a %s Plan', (status) => {
      expect(validate(withPlanStatus(status)).issues).toEqual([])
    })

    it.each(['completed', 'abandoned', 'draft'] as const)('rejects executionInProgress naming a %s Plan', (status) => {
      expectRejected(withPlanStatus(status), 'ownedWeapons[0].executionInProgress.productionPlanId', 'invalid_state')
    })

    it('still rejects executionInProgress naming a missing Plan', () => {
      const root = withPlanStatus('active')
      root.ownedWeapons[0].executionInProgress = { productionPlanId: productionPlanId('plan.missing'), startedAt: DOMAIN_FIXTURE_TIME }
      expectRejected(root, 'ownedWeapons[0].executionInProgress.productionPlanId', 'invalid_reference')
    })

    it('never requires a running Plan to have an in-progress weapon', () => {
      const root = withPlanStatus('active')
      root.ownedWeapons[0].executionInProgress = null
      expect(validate(root).issues).toEqual([])
    })

    it.each(['completed', 'abandoned', 'draft'] as const)('rejects a game save point left on a %s Plan', (status) => {
      const root = withPlanStatus(status)
      root.ownedWeapons[0].executionInProgress = null
      root.executionSavePoints = [fixtureSavePoint(DATA_TRANSFER_PLAN_ID)]
      expectRejected(root, 'executionSavePoints[0].productionPlanId', 'invalid_state')
    })
  })

  describe('ExecutionSavePoint current scope references', () => {
    it('accepts a save point whose snapshot Plan finds its selected Entries and dependent Targets', () => {
      expect(validate(dataTransferRoot()).issues).toEqual([])
    })

    it('rejects a snapshot Plan naming a selected BuildListEntry that no longer exists', () => {
      const root = dataTransferRoot()
      root.executionSavePoints[0].productionPlan.selectedBuildListEntryIds = [buildListEntryId('entry.missing')]
      expectRejected(root, 'executionSavePoints[0].productionPlan.selectedBuildListEntryIds[0]', 'invalid_reference')
    })

    it('rejects a snapshot Plan depending on a TargetWeapon that no longer exists', () => {
      const root = dataTransferRoot()
      root.executionSavePoints[0].productionPlan.steps[0].targetWeaponId = targetWeaponId('target.missing')
      root.executionSavePoints[0].productionPlan.steps[0].buildListEntryId = null
      expectRejected(root, 'executionSavePoints[0].productionPlan.dependentTargetWeaponIds', 'invalid_reference')
    })

    it('A: rejects a snapshot OwnedWeapon whose ID no longer exists in the current collection', () => {
      // The restore never revives a deleted weapon, so such a save point could
      // never be restored after the Import.
      const root = dataTransferRoot()
      root.executionSavePoints[0].ownedWeapons.push({ ...createValidOwnedWeapon(ownedWeaponId('owned.snapshot.only')), isProtected: false })
      expectRejected(root, 'executionSavePoints[0].ownedWeapons[1].id', 'invalid_reference')
    })

    it('B: accepts a snapshot OwnedWeapon that exists now, without requiring the bodies to match', () => {
      const root = dataTransferRoot()
      const current = { ...createValidOwnedWeapon(ownedWeaponId('owned.snapshot.current')), isProtected: false, name: 'renamed since the save point', status: 'ideal' as const }
      root.ownedWeapons.push(current)
      root.executionSavePoints[0].ownedWeapons.push({ ...current, name: 'as recorded', status: 'unclassified', executionInProgress: null })
      expect(validate(root).issues).toEqual([])
    })

    it('C: accepts an active current Plan with an active snapshot Plan', () => {
      const root = dataTransferRoot()
      expect(root.productionPlans[0].status).toBe('active')
      expect(root.executionSavePoints[0].productionPlan.status).toBe('active')
      expect(validate(root).issues).toEqual([])
    })

    it('D: accepts a stale current Plan with an active snapshot Plan', () => {
      // The Plan became stale after the save point was recorded; returning to
      // that active moment is exactly what the restore is for.
      const root = dataTransferRoot()
      root.productionPlans[0].status = 'stale'
      root.productionPlans[0].recalculationReasons = ['rng_state_changed']
      root.executionHistory[0].undoSnapshot.productionPlanBefore = { ...root.productionPlans[0] }
      expect(root.executionSavePoints[0].productionPlan.status).toBe('active')
      expect(validate(root).issues).toEqual([])
    })

    it.each(['stale', 'draft', 'completed', 'abandoned'] as const)('E: rejects a %s snapshot Plan', (status) => {
      const root = dataTransferRoot()
      const snapshotPlan = root.executionSavePoints[0].productionPlan
      snapshotPlan.status = status
      snapshotPlan.recalculationReasons = status === 'stale' ? ['rng_state_changed'] : []
      snapshotPlan.abandonmentReason = status === 'abandoned' ? 'user_abandoned' : null
      snapshotPlan.abandonedAt = status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null
      snapshotPlan.completedAt = status === 'completed' ? DOMAIN_FIXTURE_TIME : null
      if (status === 'completed') {
        snapshotPlan.currentStepId = null
        snapshotPlan.steps = [{ ...snapshotPlan.steps[0], isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }]
      }
      expectRejected(root, 'executionSavePoints[0].productionPlan.status', 'invalid_state')
    })

    it('F: accepts a Plan-independent snapshot Target that was deleted since', () => {
      // A Target preferring a scope weapon at the save point exists only inside
      // the snapshot now; the restore does not revive it, so its absence is not
      // an Import refusal.
      const root = dataTransferRoot()
      root.executionSavePoints[0].targetWeapons.push({ ...createValidTargetWeapon(), id: targetWeaponId('target.snapshot.only'), preferredOwnedWeaponId: ownedWeaponId('owned.fixture.a') })
      expect(root.targetWeapons.some(({ id }) => id === 'target.snapshot.only')).toBe(false)
      expect(validate(root).issues).toEqual([])
    })

    it('G: still rejects a Plan-dependent Target the snapshot Plan needs', () => {
      const root = dataTransferRoot()
      root.executionSavePoints[0].productionPlan.steps[0].progressedTargetWeaponIds = [targetWeaponId('target.missing')]
      expectRejected(root, 'executionSavePoints[0].productionPlan.dependentTargetWeaponIds', 'invalid_reference')
    })
  })

  it('leaves the ExecutionHistory / Plan pair validation to the Domain validators it reuses', () => {
    const root = dataTransferRoot()
    const history = createValidExecutionHistory()
    history.id = executionHistoryId('history.fixture.b')
    history.planId = DATA_TRANSFER_PLAN_ID
    history.undoSnapshot.productionPlanBefore = { ...createValidProductionPlan(), id: DATA_TRANSFER_PLAN_ID, status: 'active' }
    root.executionHistory.push(history)
    expect(validate(root).issues).toEqual([])
  })
})
