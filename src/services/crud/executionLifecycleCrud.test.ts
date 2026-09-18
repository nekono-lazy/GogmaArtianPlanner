import { describe, expect, it, vi } from 'vitest'
import { createOwnedWeaponDraft, createTargetWeaponDraft } from '../../domain/forms/entityDrafts'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type {
  OwnedWeapon,
  ProductionPlanId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { inMemoryPlanGuardedPersistence } from '../../test/fixtures/planGuardedPersistence'
import { OwnedWeaponCrudService, TargetWeaponCrudService } from './entityCrudServices'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data
const NOW = '2026-09-17T00:00:00.000Z'
const LATER = '2026-09-17T01:00:00.000Z'
const PLAN_ID = 'plan.execution-lifecycle' as ProductionPlanId

function ownedService(memory = inMemoryPlanGuardedPersistence()) {
  const service = new OwnedWeaponCrudService(master, {
    getAll: vi.fn(async () => [] as OwnedWeapon[]),
    getTargets: vi.fn(async () => [] as TargetWeapon[]),
    persistence: memory.persistence,
  })
  return Object.assign(service, { memory })
}

function targetService(memory = inMemoryPlanGuardedPersistence()) {
  const service = new TargetWeaponCrudService(master, {
    getAll: vi.fn(async () => [] as TargetWeapon[]),
    getOwnedWeapons: vi.fn(async () => [] as OwnedWeapon[]),
    persistence: memory.persistence,
  })
  return Object.assign(service, { memory })
}

describe('Execution lifecycle fields in ordinary CRUD', () => {
  it.each(['normal', 'gogma'] as const)(
    'registers a new %s weapon with executionInProgress null',
    async (kind) => {
      const draft = { ...createOwnedWeaponDraft(master, kind), name: 'New weapon' }
      const saved = await ownedService().save(draft, null, NOW)
      expect(saved.executionInProgress).toBeNull()
    },
  )

  it('never takes executionInProgress from a draft on create or edit', async () => {
    const service = ownedService()
    const inProgress = { productionPlanId: PLAN_ID, startedAt: NOW }
    const created = await service.save(
      { ...createOwnedWeaponDraft(master, 'gogma'), name: 'Weapon', executionInProgress: inProgress },
      null,
      NOW,
    )
    expect(created.executionInProgress).toBeNull()

    const existing: OwnedWeapon = { ...created, executionInProgress: inProgress }
    // Execution-owned fields come from the stored weapon, never from the draft.
    service.memory.seed({ ownedWeapons: [existing] })
    const edited = await service.save(
      { ...existing, name: 'Renamed', executionInProgress: null },
      existing,
      LATER,
    )
    expect(edited.name).toBe('Renamed')
    expect(edited.executionInProgress).toEqual(inProgress)
  })

  it('creates an active Target with no completion metadata', async () => {
    const draft = { ...createTargetWeaponDraft(master), name: 'New Target' }
    expect(draft).toMatchObject({
      lifecycleStatus: 'active',
      completedAt: null,
      completedByProductionPlanId: null,
    })
    const saved = await targetService().save(
      { ...draft, lifecycleStatus: 'completed', completedAt: NOW },
      null,
      NOW,
    )
    expect(saved).toMatchObject({
      lifecycleStatus: 'active',
      completedAt: null,
      completedByProductionPlanId: null,
    })
  })

  it('keeps the stored lifecycle when an existing Target is edited', async () => {
    const service = targetService()
    const created = await service.save(
      { ...createTargetWeaponDraft(master), name: 'Target' },
      null,
      NOW,
    )
    const existing: TargetWeapon = {
      ...created,
      lifecycleStatus: 'completed',
      completedAt: NOW,
      completedByProductionPlanId: PLAN_ID,
    }
    service.memory.seed({ targetWeapons: [existing] })
    const edited = await service.save(
      { ...existing, memo: 'edited', lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null },
      existing,
      LATER,
    )
    expect(edited).toMatchObject({
      memo: 'edited',
      lifecycleStatus: 'completed',
      completedAt: NOW,
      completedByProductionPlanId: PLAN_ID,
    })
  })
})
