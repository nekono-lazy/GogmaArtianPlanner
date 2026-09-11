import { describe, expect, it, vi } from 'vitest'
import { createOwnedWeaponDraft, createTargetWeaponDraft } from '../../domain/forms/entityDrafts'
import type { OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createValidOwnedWeapon, createValidTargetWeapon, DOMAIN_FIXTURE_TIME } from '../../test/fixtures/domainData'
import { EntityFormValidationError, OwnedWeaponCrudService, ReferencedEntityDeleteError, TargetWeaponCrudService } from './entityCrudServices'

describe('entity draft defaults', () => {
  const master = createValidMasterDataFixture()
  it.each([
    ['material', false],
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
  const master = createValidMasterDataFixture()
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
  it('preserves ID/createdAt and changes only updatedAt while editing', async () => {
    const deps = dependencies(); const service = new OwnedWeaponCrudService(master, deps)
    const existing = createValidOwnedWeapon(); existing.weaponTypeId = 'weapon.fixture.a'; existing.elementId = 'element.fixture.a'; existing.restorationBonuses = Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' })) as OwnedWeapon['restorationBonuses']; existing.seriesSkillId = null; existing.groupSkillId = null
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    const saved = await service.save({ ...draft, name: 'edited', status: 'material', isProtected: true }, existing, '2026-08-29T09:00:00.000Z')
    expect(saved.id).toBe(existing.id); expect(saved.createdAt).toBe(existing.createdAt); expect(saved.updatedAt).toBe('2026-08-29T09:00:00.000Z'); expect(saved.isProtected).toBe(true)
  })
  it('rejects an unavailable weapon-specific Rank', async () => {
    const service = new OwnedWeaponCrudService(master, dependencies())
    const draft = createOwnedWeaponDraft(master); draft.name = 'invalid'; draft.restorationBonuses[0].bonusRankId = 'rank.unavailable'
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).rejects.toBeInstanceOf(EntityFormValidationError)
  })
  it('blocks referenced deletion and exposes references', async () => {
    const deps = dependencies([{ kind: 'build_list_entry', entityId: 'entry-1', path: 'candidateSnapshot.route' }]); const service = new OwnedWeaponCrudService(master, deps)
    await expect(service.delete(createValidOwnedWeapon().id)).rejects.toBeInstanceOf(ReferencedEntityDeleteError)
    expect(deps.delete).not.toHaveBeenCalled()
  })
})

describe('TargetWeaponCrudService', () => {
  const master = createValidMasterDataFixture()
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
    const alternativeMaster = structuredClone(master)
    alternativeMaster.weaponBonusDefinitions.push({ ...master.weaponBonusDefinitions[1], id: 'fixture.alternative', bonusTypeId: 'bonus_type.fixture.unused' })
    const service = new TargetWeaponCrudService(alternativeMaster, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'; draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.fixture.attack', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 }]; draft.alternativeBonusRules = [{ id: 'group', sourceBonusTypeId: 'bonus_type.fixture.attack', maxReplacementCount: 1, options: [{ alternativeBonusTypeId: 'bonus_type.fixture.unused', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 }] }]; draft.idealSkillCondition = { seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: null, matchMode: 'all' }
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ priority: 3, practicalBonusConditions: draft.practicalBonusConditions })
    draft.practicalBonusConditions[0].requiredExCount = -1
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).rejects.toBeInstanceOf(EntityFormValidationError)
  })
  it('rejects a Target whose idealBonuses break the Ideal implies Practical containment', async () => {
    const service = new TargetWeaponCrudService(master, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.fixture.element', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 }]
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringContaining('practicalBonusConditions[0]'))
  })
  it('rejects a Target whose Skill conditions break the Ideal implies Practical containment', async () => {
    const service = new TargetWeaponCrudService(master, dependencies())
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.idealSkillCondition = { seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: 'group_skill.fixture.enabled', matchMode: 'any' }
    draft.practicalSkillCondition = { seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: 'group_skill.fixture.enabled', matchMode: 'all' }
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringContaining('practicalSkillCondition'))
  })
  it('saves a Target whose Ideal is a strict upper bound of Practical', async () => {
    const deps = dependencies(); const service = new TargetWeaponCrudService(master, deps)
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.practicalBonusConditions = [{ id: 'condition', bonusTypeId: 'bonus_type.fixture.attack', minimumRankId: 'bonus_rank.fixture.high', requiredExCount: 0 }]
    draft.idealSkillCondition = { seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: 'group_skill.fixture.enabled', matchMode: 'all' }
    draft.practicalSkillCondition = { seriesSkillId: 'series_skill.fixture.enabled', groupSkillId: null, matchMode: 'all' }
    await expect(service.save(draft, null, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ practicalBonusConditions: draft.practicalBonusConditions })
    expect(deps.put).toHaveBeenCalledTimes(1)
  })
  it('blocks referenced Target deletion', async () => {
    const deps = dependencies(true); const service = new TargetWeaponCrudService(master, deps)
    await expect(service.delete(createValidTargetWeapon().id)).rejects.toBeInstanceOf(ReferencedEntityDeleteError)
    expect(deps.delete).not.toHaveBeenCalled()
  })
})
