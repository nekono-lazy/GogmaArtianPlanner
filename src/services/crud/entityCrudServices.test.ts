import { describe, expect, it, vi } from 'vitest'
import { createOwnedWeaponDraft, createTargetWeaponDraft } from '../../domain/forms/entityDrafts'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, RestorationBonus, TargetWeapon } from '../../domain/models/publicTypes'
import { createValidOwnedWeapon, createValidTargetWeapon, DOMAIN_FIXTURE_TIME } from '../../test/fixtures/domainData'
import { EntityFormValidationError, OwnedWeaponCrudService, ReferencedEntityDeleteError, TargetWeaponCrudService } from './entityCrudServices'

// Saves are validated against Production bonus availability, which only the
// verified Master's weapon types / elements can satisfy.
const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const verifiedMaster = loadedMaster.data
const ENABLED_SERIES_SKILL_ID = verifiedMaster.seriesSkills.find(({ isEnabled }) => isEnabled)!.id
const ENABLED_GROUP_SKILL_ID = verifiedMaster.groupSkills.find(({ isEnabled }) => isEnabled)!.id
const GOGMA_ATTACK: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }
const GOGMA_ELEMENT: RestorationBonus = { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' }

describe('entity draft defaults', () => {
  const master = verifiedMaster
  it.each([
    ['unclassified', false],
    ['practical', false],
    ['ideal', true],
  ] as const)('sets %s protection only at creation', (status, expected) => {
    const draft = createOwnedWeaponDraft(master, status)
    expect(draft.isProtected).toBe(expected)
    expect(draft.restorationBonuses).toHaveLength(5)
  })
  it('creates Target defaults with priority 3 and five Ideal slots', () => {
    const draft = createTargetWeaponDraft(master)
    expect(draft.priority).toBe(3)
    expect(draft.idealBonuses).toHaveLength(5)
  })
})

describe('OwnedWeaponCrudService', () => {
  const master = verifiedMaster
  function dependencies(
    references: Array<{ kind: 'build_list_entry'; entityId: string; path: string }> = [],
    targets: TargetWeapon[] = [],
  ) {
    return {
      getAll: vi.fn(async () => [] as OwnedWeapon[]),
      getTargets: vi.fn(async () => targets),
      put: vi.fn(async (value: OwnedWeapon) => value),
      putReleasingTargets: vi.fn(async (value: OwnedWeapon, released: readonly TargetWeapon[]) => {
        released.forEach((target) => {
          const index = targets.findIndex(({ id }) => id === target.id)
          if (index >= 0) targets[index] = target
        })
        return value
      }),
      delete: vi.fn(async () => undefined),
      findReferences: vi.fn(async () => references),
    }
  }
  function storedGogma(weaponTypeId: string, elementId: string, first: RestorationBonus): OwnedGogmaArtianWeapon {
    const existing = createValidOwnedWeapon()
    return {
      ...existing,
      kind: 'gogma',
      weaponTypeId,
      elementId,
      restorationBonusScope: 'gogma_artian',
      restorationBonuses: [first, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK],
      seriesSkillId: null,
      groupSkillId: null,
    } as OwnedGogmaArtianWeapon
  }
  it('preserves ID/createdAt and changes only updatedAt while editing', async () => {
    const deps = dependencies(); const service = new OwnedWeaponCrudService(master, deps)
    const existing = storedGogma('weapon.great_sword', 'element.none', GOGMA_ATTACK)
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    const saved = await service.save({ ...draft, name: 'edited', status: 'unclassified', isProtected: true }, existing, '2026-08-29T09:00:00.000Z')
    expect(saved.id).toBe(existing.id); expect(saved.createdAt).toBe(existing.createdAt); expect(saved.updatedAt).toBe('2026-08-29T09:00:00.000Z'); expect(saved.isProtected).toBe(true)
  })
  it('rejects an unavailable weapon-specific Rank', async () => {
    const service = new OwnedWeaponCrudService(master, dependencies())
    const draft = createOwnedWeaponDraft(master); draft.name = 'invalid'; draft.restorationBonuses[0].bonusRankId = 'rank.unavailable'
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).rejects.toBeInstanceOf(EntityFormValidationError)
  })
  it('saves an Element bonus on a Switch Axe element.none weapon', async () => {
    const deps = dependencies(); const service = new OwnedWeaponCrudService(master, deps)
    const existing = storedGogma('weapon.switch_axe', 'element.none', GOGMA_ELEMENT)
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    await expect(service.save(draft, existing, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ restorationBonuses: existing.restorationBonuses })
    expect(deps.put).toHaveBeenCalledTimes(1)
  })
  it('refuses to save a stored Bow Poison Element bonus outside Production availability without rewriting it', async () => {
    const deps = dependencies(); const service = new OwnedWeaponCrudService(master, deps)
    const existing = storedGogma('weapon.bow', 'element.poison', GOGMA_ELEMENT)
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    const error = await service.save({ ...draft, name: 'renamed' }, existing, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringMatching(/^restorationBonuses\[0\]: .*Productionで抽選されない/))
    expect(deps.put).not.toHaveBeenCalled()
    expect(deps.putReleasingTargets).not.toHaveBeenCalled()
    expect(existing.restorationBonuses[0]).toEqual(GOGMA_ELEMENT)
  })
  it('blocks referenced deletion and exposes references', async () => {
    const deps = dependencies([{ kind: 'build_list_entry', entityId: 'entry-1', path: 'candidateSnapshot.route' }]); const service = new OwnedWeaponCrudService(master, deps)
    await expect(service.delete(createValidOwnedWeapon().id)).rejects.toBeInstanceOf(ReferencedEntityDeleteError)
    expect(deps.delete).not.toHaveBeenCalled()
  })
})

describe('TargetWeaponCrudService', () => {
  const master = verifiedMaster
  function dependencies(
    referenced = false,
    targets: TargetWeapon[] = [],
    ownedWeapons: OwnedWeapon[] = [],
  ) {
    return {
      getAll: vi.fn(async () => targets),
      getOwnedWeapons: vi.fn(async () => ownedWeapons),
      put: vi.fn(async (value: TargetWeapon) => value),
      putReleasingTargets: vi.fn(async (value: TargetWeapon, released: readonly TargetWeapon[]) => {
        released.forEach((target) => {
          const index = targets.findIndex(({ id }) => id === target.id)
          if (index >= 0) targets[index] = target
        })
        return value
      }),
      delete: vi.fn(async () => undefined),
      findReferences: vi.fn(async () => referenced ? [{ kind: 'build_list_entry' as const, entityId: 'entry-1', path: 'targetWeaponId' }] : []),
    }
  }
  it('saves Practical/Alternative/Skill conditions and validates count ranges', async () => {
    const service = new TargetWeaponCrudService(master, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'; draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.attack', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }]; draft.alternativeBonusRules = [{ id: 'group', sourceBonusTypeId: 'bonus_type.attack', maxReplacementCount: 1, options: [{ alternativeBonusTypeId: 'bonus_type.affinity', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }] }]; draft.idealSkillCondition = { seriesSkillId: ENABLED_SERIES_SKILL_ID, groupSkillId: null, matchMode: 'all' }
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ priority: 3, practicalBonusConditions: draft.practicalBonusConditions })
    draft.practicalBonusConditions[0].requiredExCount = -1
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).rejects.toBeInstanceOf(EntityFormValidationError)
  })
  it('rejects a Target whose idealBonuses break the Ideal implies Practical containment', async () => {
    const service = new TargetWeaponCrudService(master, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.affinity', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }]
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringContaining('practicalBonusConditions[0]'))
  })
  it('rejects a Target whose Skill conditions break the Ideal implies Practical containment', async () => {
    const service = new TargetWeaponCrudService(master, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.idealSkillCondition = { seriesSkillId: ENABLED_SERIES_SKILL_ID, groupSkillId: ENABLED_GROUP_SKILL_ID, matchMode: 'any' }
    draft.practicalSkillCondition = { seriesSkillId: ENABLED_SERIES_SKILL_ID, groupSkillId: ENABLED_GROUP_SKILL_ID, matchMode: 'all' }
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringContaining('practicalSkillCondition'))
  })
  it('saves a Target whose Ideal is a strict upper bound of Practical', async () => {
    const deps = dependencies(); const service = new TargetWeaponCrudService(master, deps)
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.attack', minimumRankId: 'bonus_rank.ii', requiredExCount: 0 }]
    draft.idealSkillCondition = { seriesSkillId: ENABLED_SERIES_SKILL_ID, groupSkillId: ENABLED_GROUP_SKILL_ID, matchMode: 'all' }
    draft.practicalSkillCondition = { seriesSkillId: ENABLED_SERIES_SKILL_ID, groupSkillId: null, matchMode: 'all' }
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ practicalBonusConditions: draft.practicalBonusConditions })
    expect(deps.put).toHaveBeenCalledTimes(1)
  })
  it('refuses to save an Element ideal bonus on a Bow Poison Target', async () => {
    const deps = dependencies(); const service = new TargetWeaponCrudService(master, deps)
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.weaponTypeId = 'weapon.bow'; draft.elementId = 'element.poison'
    draft.idealBonuses = [GOGMA_ELEMENT, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK]
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringMatching(/^idealBonuses\[0\]: .*Productionで抽選されない/))
    expect(deps.put).not.toHaveBeenCalled()
  })
  it('blocks referenced Target deletion', async () => {
    const deps = dependencies(true); const service = new TargetWeaponCrudService(master, deps)
    await expect(service.delete(createValidTargetWeapon().id)).rejects.toBeInstanceOf(ReferencedEntityDeleteError)
    expect(deps.delete).not.toHaveBeenCalled()
  })
})
