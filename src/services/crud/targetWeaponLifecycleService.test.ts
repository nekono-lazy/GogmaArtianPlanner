import { describe, expect, it } from 'vitest'
import type { PlanGuardPersistedState } from '../../domain/execution'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  ProductionPlanId,
  RestorationBonus,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidRngState,
} from '../../test/fixtures/domainData'
import { inMemoryPlanGuardedPersistence } from '../../test/fixtures/planGuardedPersistence'
import { EntityFormValidationError } from './entityCrudServices'
import { TargetWeaponLifecycleError, TargetWeaponLifecycleService } from './targetWeaponLifecycleService'

/**
 * 「この武器で目標を完了にする」 and 「未完了に戻す」 (`docs/UI_FLOW.md` 8.2 / 8.3,
 * `docs/PLANNER_SPEC.md` 16.13, `docs/DATA_MODEL.md` 8.1 / 8.5) over the in-memory
 * guarded persistence: the same pure decision the Dexie guard makes.
 */

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data
const NOW = '2026-09-22T10:00:00.000Z'
const ATTACK_EX: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ex' }
const ATTACK_II: RestorationBonus = { bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' }
const SERIES = master.seriesSkills.find(({ isEnabled }) => isEnabled)!.id

function target(id: string, patch: Partial<TargetWeapon> = {}): TargetWeapon {
  return {
    id: id as TargetWeapon['id'], name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', priority: 3, isEnabled: true,
    preferredOwnedWeaponId: null, lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null,
    idealBonuses: [ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX],
    practicalBonusConditions: [], alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId: SERIES, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'all' },
    memo: null, createdAt: 'created', updatedAt: 'updated', ...patch,
  }
}

function gogma(id: string, patch: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return {
    id: id as OwnedWeapon['id'], kind: 'gogma', name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder',
    restorationBonusScope: 'gogma_artian', restorationBonuses: [ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX],
    seriesSkillId: SERIES, groupSkillId: null, status: 'unclassified', isProtected: false, executionInProgress: null,
    memo: 'memo', createdAt: 'created', updatedAt: 'updated', ...patch,
  }
}

function normal(id: string): OwnedNormalArtianWeapon {
  return {
    id: id as OwnedWeapon['id'], kind: 'normal', name: id, weaponTypeId: 'weapon.dual_blades', elementId: 'element.thunder', rarity: 8,
    restorationBonusScope: 'normal_artian',
    restorationBonuses: Array.from({ length: 5 }, () => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.base' })) as OwnedWeapon['restorationBonuses'],
    seriesSkillId: null, groupSkillId: null, status: null, isProtected: false, executionInProgress: null, memo: null, createdAt: 'created', updatedAt: 'updated',
  }
}

function serviceWith(initial: Partial<PlanGuardPersistedState>, options: { writeFailure?: Error } = {}) {
  const memory = inMemoryPlanGuardedPersistence(initial, { ...options, now: NOW })
  return { service: new TargetWeaponLifecycleService(master, { persistence: memory.persistence }), memory }
}

function artifacts(): Partial<PlanGuardPersistedState> {
  return {
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    buildCandidates: [createValidBuildCandidate()],
    buildListEntries: [createValidBuildListEntry()],
    executionHistory: [createValidExecutionHistory()],
  }
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (caught: unknown) => caught)
}

describe('TargetWeaponLifecycleService.completeWithOwnedIdeal', () => {
  it('completes the Target and protects the weapon as an Ideal without touching its performance', async () => {
    const weapon = gogma('owned.ideal', { status: 'practical' })
    const { service, memory } = serviceWith({ targetWeapons: [target('target.a')], ownedWeapons: [weapon] })

    const result = await service.completeWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW)

    expect(result.target).toMatchObject({
      id: 'target.a', lifecycleStatus: 'completed', completedAt: NOW, completedByProductionPlanId: null, preferredOwnedWeaponId: null, updatedAt: NOW,
    })
    expect(result.ownedWeapon).toEqual({ ...weapon, status: 'ideal', isProtected: true, updatedAt: NOW })
    expect(result.releasedTargetIds).toEqual([])
    expect(memory.state().targetWeapons).toEqual([result.target])
    expect(memory.state().ownedWeapons).toEqual([result.ownedWeapon])
    expect(memory.commits()).toBe(1)
  })

  it('releases only the preference of every other Target preferring the weapon', async () => {
    const weapon = gogma('owned.shared')
    const other = gogma('owned.other')
    const a = target('target.a')
    const b = target('target.b', { preferredOwnedWeaponId: weapon.id, priority: 5, isEnabled: false, memo: 'keep' })
    const c = target('target.c', { preferredOwnedWeaponId: weapon.id, name: 'C' })
    const d = target('target.d', { preferredOwnedWeaponId: other.id })
    const { service, memory } = serviceWith({ targetWeapons: [a, b, c, d], ownedWeapons: [weapon, other] })

    const result = await service.completeWithOwnedIdeal(a.id, weapon.id, NOW)

    expect(result.releasedTargetIds).toEqual([b.id, c.id])
    const stored = new Map(memory.state().targetWeapons.map((stored) => [stored.id, stored]))
    expect(stored.get(b.id)).toEqual({ ...b, preferredOwnedWeaponId: null, updatedAt: NOW })
    expect(stored.get(c.id)).toEqual({ ...c, preferredOwnedWeaponId: null, updatedAt: NOW })
    expect(stored.get(d.id)).toEqual(d)
    expect(memory.state().ownedWeapons.find(({ id }) => id === other.id)).toEqual(other)
  })

  it('advances no Counter and touches no Candidate, Entry or ExecutionHistory', async () => {
    const weapon = gogma('owned.ideal')
    const initial = { ...artifacts(), targetWeapons: [target('target.a')], ownedWeapons: [weapon] }
    const { service, memory } = serviceWith(initial)
    const before = structuredClone(memory.state())

    await service.completeWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW)

    const after = memory.state()
    expect(after.rngState).toEqual(before.rngState)
    expect(after.normalCounters).toEqual(before.normalCounters)
    expect(after.buildCandidates).toEqual(before.buildCandidates)
    expect(after.buildListEntries).toEqual(before.buildListEntries)
    expect(after.executionHistory).toEqual(before.executionHistory)
    expect(after.executionSavePoints).toEqual(before.executionSavePoints)
    expect(after.productionPlans).toEqual(before.productionPlans)
  })

  it('keeps the stored in-progress mark, which is Execution-owned', async () => {
    const inProgress = { productionPlanId: 'plan.x' as ProductionPlanId, startedAt: NOW }
    const weapon = gogma('owned.ideal', { executionInProgress: inProgress })
    const { service } = serviceWith({ targetWeapons: [target('target.a')], ownedWeapons: [weapon] })
    const result = await service.completeWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW)
    expect(result.ownedWeapon.executionInProgress).toEqual(inProgress)
  })

  describe('re-validates the current state and refuses a stale judgement', () => {
    const shownTarget = target('target.a')
    const shownWeapon = gogma('owned.ideal')

    it.each([
      ['a deleted Target', { targetWeapons: [], ownedWeapons: [shownWeapon] }, 'target_not_found'],
      ['a Target already completed', { targetWeapons: [target('target.a', { lifecycleStatus: 'completed', completedAt: NOW })], ownedWeapons: [shownWeapon] }, 'target_not_active'],
      ['a deleted weapon', { targetWeapons: [shownTarget], ownedWeapons: [] }, 'owned_weapon_not_found'],
      ['a weapon that is now a Normal', { targetWeapons: [shownTarget], ownedWeapons: [normal('owned.ideal')] }, 'owned_weapon_not_gogma'],
      ['a weapon re-typed to another element', { targetWeapons: [shownTarget], ownedWeapons: [gogma('owned.ideal', { elementId: 'element.fire' })] }, 'owned_weapon_incompatible'],
      ['a weapon whose bonuses changed', { targetWeapons: [shownTarget], ownedWeapons: [gogma('owned.ideal', { restorationBonuses: [ATTACK_II, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] })] }, 'owned_weapon_no_longer_ideal'],
      ['a weapon whose Skill changed', { targetWeapons: [shownTarget], ownedWeapons: [gogma('owned.ideal', { seriesSkillId: null })] }, 'owned_weapon_no_longer_ideal'],
      ['a Target whose Ideal condition changed', { targetWeapons: [target('target.a', { idealBonuses: [ATTACK_II, ATTACK_EX, ATTACK_EX, ATTACK_EX, ATTACK_EX] })], ownedWeapons: [shownWeapon] }, 'owned_weapon_no_longer_ideal'],
    ] as const)('refuses %s with no write', async (_label, current, code) => {
      const { service, memory } = serviceWith(current)
      const before = structuredClone(memory.state())
      const inspection = await failure(() => service.inspectCompleteWithOwnedIdeal(shownTarget.id, shownWeapon.id, NOW))
      expect(inspection).toBeInstanceOf(TargetWeaponLifecycleError)
      const caught = await failure(() => service.completeWithOwnedIdeal(shownTarget.id, shownWeapon.id, NOW))
      expect(caught).toBeInstanceOf(TargetWeaponLifecycleError)
      expect((caught as TargetWeaponLifecycleError).code).toBe(code)
      expect(memory.state()).toEqual(before)
      expect(memory.commits()).toBe(0)
    })
  })

  it('leaves everything unchanged when the write fails', async () => {
    const weapon = gogma('owned.shared')
    const initial = { targetWeapons: [target('target.a'), target('target.b', { preferredOwnedWeaponId: weapon.id })], ownedWeapons: [weapon] }
    const { service, memory } = serviceWith(initial, { writeFailure: new Error('storage failure') })
    const before = structuredClone(memory.state())
    await expect(service.completeWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW)).rejects.toThrow('storage failure')
    expect(memory.state()).toEqual(before)
    expect(memory.commits()).toBe(0)
  })

  it('needs no approval and touches no Plan when the Target and weapon are Plan-independent', async () => {
    const weapon = gogma('owned.ideal')
    const { service } = serviceWith({ targetWeapons: [target('target.a')], ownedWeapons: [weapon] })
    expect(await service.inspectCompleteWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW)).toEqual({ approvalRequired: false })
  })

  it('reports a collection violation as a validation error rather than persisting it', async () => {
    // Another Target already prefers a weapon of another element: the stored
    // state is inconsistent before the completion, and the collection
    // validation refuses to persist the post-state.
    const weapon = gogma('owned.ideal')
    const stray = gogma('owned.stray', { elementId: 'element.fire' })
    const { service, memory } = serviceWith({
      targetWeapons: [target('target.a'), target('target.b', { preferredOwnedWeaponId: stray.id })],
      ownedWeapons: [weapon, stray],
    })
    const before = structuredClone(memory.state())
    const caught = await failure(() => service.completeWithOwnedIdeal('target.a' as TargetWeapon['id'], weapon.id, NOW))
    expect(caught).toBeInstanceOf(EntityFormValidationError)
    expect(memory.state()).toEqual(before)
  })
})

describe('TargetWeaponLifecycleService.reopen', () => {
  const completed = target('target.done', { lifecycleStatus: 'completed', completedAt: '2026-09-01T00:00:00.000Z', completedByProductionPlanId: 'plan.done' as ProductionPlanId })

  it('returns the Target to active with no completion metadata and no preference, touching no weapon', async () => {
    const weapon = gogma('owned.ideal', { status: 'ideal', isProtected: true })
    const { service, memory } = serviceWith({ targetWeapons: [completed], ownedWeapons: [weapon] })
    const before = structuredClone(memory.state())

    const reopened = await service.reopen(completed.id, NOW)

    expect(reopened).toEqual({ ...completed, lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null, preferredOwnedWeaponId: null, updatedAt: NOW })
    expect(memory.state().targetWeapons).toEqual([reopened])
    expect(memory.state().ownedWeapons).toEqual(before.ownedWeapons)
    expect(memory.commits()).toBe(1)
  })

  it.each([
    ['a deleted Target', [], 'target_not_found'],
    ['a Target that is already active', [target('target.done')], 'target_not_completed'],
  ] as const)('refuses %s with no write', async (_label, targetWeapons, code) => {
    const { service, memory } = serviceWith({ targetWeapons: [...targetWeapons] })
    const before = structuredClone(memory.state())
    const inspection = await failure(() => service.inspectReopen(completed.id, NOW))
    expect(inspection).toBeInstanceOf(TargetWeaponLifecycleError)
    const caught = await failure(() => service.reopen(completed.id, NOW))
    expect((caught as TargetWeaponLifecycleError).code).toBe(code)
    expect(memory.state()).toEqual(before)
    expect(memory.commits()).toBe(0)
  })

  it('needs no approval when no Plan is running', async () => {
    const { service } = serviceWith({ targetWeapons: [completed] })
    expect(await service.inspectReopen(completed.id, NOW)).toEqual({ approvalRequired: false })
  })
})
