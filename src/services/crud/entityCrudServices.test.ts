import { describe, expect, it, vi } from 'vitest'
import { createOwnedWeaponDraft, createTargetWeaponDraft } from '../../domain/forms/entityDrafts'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, ProductionPlanId, RestorationBonus, TargetWeapon } from '../../domain/models/publicTypes'
import { normalWeapon } from '../../test/fixtures/constrainedEnumeration'
import { orchestrationSource } from '../../test/fixtures/plannerConstrainedOrchestration'
import { createBuildListEntry } from '../../domain/buildList'
import type { PlanGuardPersistedState } from '../../domain/execution'
import { createValidBuildCandidate, createValidOwnedWeapon, createValidTargetWeapon, DOMAIN_FIXTURE_TIME } from '../../test/fixtures/domainData'
import { inMemoryPlanGuardedPersistence } from '../../test/fixtures/planGuardedPersistence'
import { applyOwnedWeaponUserChanges, EntityFormValidationError, OwnedWeaponCrudService, ReferencedEntityDeleteError, TargetWeaponCrudService, type OwnedWeaponDraft } from './entityCrudServices'

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
  function dependencies(ownedWeapons: OwnedWeapon[] = [], initial: Partial<PlanGuardPersistedState> = {}) {
    const memory = inMemoryPlanGuardedPersistence({ ownedWeapons, ...initial })
    return {
      getAll: vi.fn(async () => [] as OwnedWeapon[]),
      getTargets: vi.fn(async () => [] as TargetWeapon[]),
      persistence: memory.persistence,
      memory,
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
    const existing = storedGogma('weapon.great_sword', 'element.none', GOGMA_ATTACK)
    const deps = dependencies([existing]); const service = new OwnedWeaponCrudService(master, deps)
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
    const existing = storedGogma('weapon.switch_axe', 'element.none', GOGMA_ELEMENT)
    const deps = dependencies([existing]); const service = new OwnedWeaponCrudService(master, deps)
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    await expect(service.save(draft, existing, DOMAIN_FIXTURE_TIME)).resolves.toMatchObject({ restorationBonuses: existing.restorationBonuses })
    expect(deps.memory.commits()).toBe(1)
  })
  it('refuses to save a stored Bow Poison Element bonus outside Production availability without rewriting it', async () => {
    const existing = storedGogma('weapon.bow', 'element.poison', GOGMA_ELEMENT)
    const deps = dependencies([existing]); const service = new OwnedWeaponCrudService(master, deps)
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = existing; void _id; void _created; void _updated
    const error = await service.save({ ...draft, name: 'renamed' }, existing, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringMatching(/^restorationBonuses\[0\]: .*Productionで抽選されない/))
    expect(deps.memory.commits()).toBe(0)
    expect(deps.memory.state().ownedWeapons).toEqual([existing])
    expect(existing.restorationBonuses[0]).toEqual(GOGMA_ELEMENT)
  })
  it('blocks referenced deletion and exposes references', async () => {
    const weapon = createValidOwnedWeapon()
    const target = { ...createValidTargetWeapon(), preferredOwnedWeaponId: weapon.id }
    const deps = dependencies([weapon], { targetWeapons: [target] }); const service = new OwnedWeaponCrudService(master, deps)
    const error = await service.delete(weapon.id).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ReferencedEntityDeleteError)
    expect((error as ReferencedEntityDeleteError).references).toEqual([{ kind: 'target_weapon', entityId: target.id, path: 'preferredOwnedWeaponId' }])
    expect(deps.memory.commits()).toBe(0)
    expect(deps.memory.state().ownedWeapons).toEqual([weapon])
  })
})

describe('TargetWeaponCrudService', () => {
  const master = verifiedMaster
  function dependencies(initial: Partial<PlanGuardPersistedState> = {}) {
    const memory = inMemoryPlanGuardedPersistence(initial)
    return {
      getAll: vi.fn(async () => [] as TargetWeapon[]),
      getOwnedWeapons: vi.fn(async () => [] as OwnedWeapon[]),
      persistence: memory.persistence,
      memory,
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
    expect(deps.memory.commits()).toBe(1)
  })
  it('refuses to save an Element ideal bonus on a Bow Poison Target', async () => {
    const deps = dependencies(); const service = new TargetWeaponCrudService(master, deps)
    const draft = createTargetWeaponDraft(master); draft.name = 'target'
    draft.weaponTypeId = 'weapon.bow'; draft.elementId = 'element.poison'
    draft.idealBonuses = [GOGMA_ELEMENT, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK, GOGMA_ATTACK]
    const error = await service.save(draft, null, DOMAIN_FIXTURE_TIME).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EntityFormValidationError)
    expect((error as EntityFormValidationError).issues).toContainEqual(expect.stringMatching(/^idealBonuses\[0\]: .*Productionで抽選されない/))
    expect(deps.memory.commits()).toBe(0)
  })
  it('blocks referenced Target deletion', async () => {
    const target = createValidTargetWeapon()
    const entry = createBuildListEntry(createValidBuildCandidate(), target, { createdAt: DOMAIN_FIXTURE_TIME })
    const deps = dependencies({ targetWeapons: [target], buildListEntries: [entry] }); const service = new TargetWeaponCrudService(master, deps)
    const error = await service.delete(target.id).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ReferencedEntityDeleteError)
    expect((error as ReferencedEntityDeleteError).references).toEqual([{ kind: 'build_list_entry', entityId: entry.id, path: 'targetWeaponId' }])
    expect(deps.memory.commits()).toBe(0)
    expect(deps.memory.state().targetWeapons).toEqual([target])
  })
})

describe('applyOwnedWeaponUserChanges', () => {
  // The same OwnedWeapon ID as a Normal (at a save point) and as the Gogma it
  // was converted into afterwards.
  const restoredNormal = { ...normalWeapon('owned.cross-kind'), isProtected: false, memo: 'at save point' }
  const shownGogma = { ...orchestrationSource('owned.cross-kind'), memo: 'at save point', createdAt: '2026-09-17T05:00:00.000Z' }
  function draftFrom(weapon: OwnedWeapon): OwnedWeaponDraft {
    const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = weapon
    void _id; void _created; void _updated
    return draft as OwnedWeaponDraft
  }

  it('keeps the stored kind and applies only the shared fields the user changed', () => {
    const draft = { ...draftFrom(shownGogma), isProtected: true, name: 'renamed' } as OwnedWeaponDraft
    const applied = applyOwnedWeaponUserChanges(restoredNormal, shownGogma, draft)

    expect(applied.kind).toBe('normal')
    expect(applied).toEqual({ ...restoredNormal, isProtected: true, name: 'renamed' })
    // The Normal variant holds no Skill and no status: the shown Gogma's never come back.
    expect(shownGogma.seriesSkillId).not.toBeNull()
    expect(applied).toMatchObject({ seriesSkillId: null, groupSkillId: null, status: null, rarity: 8, restorationBonusScope: 'normal_artian' })
  })

  it('refuses a change the stored kind cannot hold instead of forcing the shown Gogma back', () => {
    const skill = { ...draftFrom(shownGogma), seriesSkillId: 'series_skill.fixture.y' } as OwnedWeaponDraft
    expect(() => applyOwnedWeaponUserChanges(restoredNormal, shownGogma, skill)).toThrow(EntityFormValidationError)
    const status = { ...draftFrom(shownGogma), status: 'ideal' } as OwnedWeaponDraft
    expect(() => applyOwnedWeaponUserChanges(restoredNormal, shownGogma, status)).toThrow(/seriesSkillId|status/)
  })

  it('never takes the in-progress mark or the timestamps from the draft', () => {
    const draft = {
      ...draftFrom(shownGogma),
      executionInProgress: { productionPlanId: 'plan.stale' as ProductionPlanId, startedAt: DOMAIN_FIXTURE_TIME },
    } as OwnedWeaponDraft
    expect(applyOwnedWeaponUserChanges(restoredNormal, shownGogma, draft)).toEqual(restoredNormal)
  })

  it('is the ordinary three-way apply while the stored kind matches what the screen showed', () => {
    const stored = { ...shownGogma, seriesSkillId: 'series_skill.fixture.stored' }
    const draft = { ...draftFrom(shownGogma), isProtected: true } as OwnedWeaponDraft
    expect(applyOwnedWeaponUserChanges(stored, shownGogma, draft)).toEqual({ ...stored, isProtected: true })
  })
})
