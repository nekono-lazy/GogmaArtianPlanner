import { describe, expect, it } from 'vitest'
import {
  executionSavePointIdForPlan,
  type ExecutionSavePoint,
  type ProductionPlanId,
} from '../../domain/models/publicTypes'
import {
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  executionHistoryId,
  productionPlanId,
} from '../../test/fixtures/domainData'
import { AppDatabase } from '../AppDatabase'
import { RepositoryError } from '../repositoryError'
import { ExecutionSavePointRepository } from './executionSavePointRepository'

function savePoint(
  planId: ProductionPlanId,
  recordedAt = '2026-09-17T00:00:00.000Z',
): ExecutionSavePoint {
  const plan = { ...createValidProductionPlan(), id: planId, status: 'active' as const }
  return {
    id: executionSavePointIdForPlan(planId),
    productionPlanId: planId,
    lastExecutionHistoryId: null,
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [createValidOwnedWeapon()],
    targetWeapons: [createValidTargetWeapon()],
    productionPlan: plan,
    recordedAt,
  }
}

async function withRepository(
  run: (repository: ExecutionSavePointRepository, database: AppDatabase) => Promise<void>,
) {
  const database = new AppDatabase(`execution-save-point-${crypto.randomUUID()}`)
  try {
    await database.open()
    await run(new ExecutionSavePointRepository(database), database)
  } finally {
    await database.delete()
  }
}

describe('ExecutionSavePointRepository', () => {
  const planA = productionPlanId('plan.save-point.a')
  const planB = productionPlanId('plan.save-point.b')

  it('derives one stable ID per Plan', () => {
    expect(executionSavePointIdForPlan(planA)).toBe(executionSavePointIdForPlan(planA))
    expect(executionSavePointIdForPlan(planA)).not.toBe(executionSavePointIdForPlan(planB))
  })

  it('stores a save point per Plan and reads it back by Plan', async () => {
    await withRepository(async (repository) => {
      const stored = savePoint(planA)
      await repository.putExecutionSavePoint(stored)
      expect(await repository.getExecutionSavePointByPlan(planA)).toEqual(stored)
      expect(await repository.getExecutionSavePointByPlan(planB)).toBeUndefined()
    })
  })

  it('replaces the previous save point of the same Plan with the latest one', async () => {
    await withRepository(async (repository, database) => {
      await repository.putExecutionSavePoint(savePoint(planA, '2026-09-17T00:00:00.000Z'))
      const latest = {
        ...savePoint(planA, '2026-09-17T02:00:00.000Z'),
        lastExecutionHistoryId: executionHistoryId('history.save-point.latest'),
      }
      await repository.putExecutionSavePoint(latest)
      expect(await database.executionSavePoints.count()).toBe(1)
      expect(await repository.getExecutionSavePointByPlan(planA)).toEqual(latest)
    })
  })

  it('keeps save points of different Plans independent', async () => {
    await withRepository(async (repository) => {
      const first = savePoint(planA)
      const second = savePoint(planB)
      await repository.putExecutionSavePoint(first)
      await repository.putExecutionSavePoint(second)
      await repository.putExecutionSavePoint(savePoint(planA, '2026-09-17T03:00:00.000Z'))
      expect(await repository.getExecutionSavePointByPlan(planB)).toEqual(second)
      expect(await repository.getAllExecutionSavePoints()).toHaveLength(2)

      await repository.deleteExecutionSavePointByPlan(planA)
      expect(await repository.getExecutionSavePointByPlan(planA)).toBeUndefined()
      expect(await repository.getExecutionSavePointByPlan(planB)).toEqual(second)
    })
  })

  it('clears every save point', async () => {
    await withRepository(async (repository) => {
      await repository.putExecutionSavePoint(savePoint(planA))
      await repository.putExecutionSavePoint(savePoint(planB))
      await repository.clearExecutionSavePoints()
      expect(await repository.getAllExecutionSavePoints()).toEqual([])
    })
  })

  it('refuses a save point whose ID is not derived from its Plan', async () => {
    await withRepository(async (repository, database) => {
      const invalid = { ...savePoint(planA), id: 'execution-save-point:random' }
      await expect(repository.putExecutionSavePoint(invalid)).rejects.toBeInstanceOf(RepositoryError)
      const mismatchedPlan = {
        ...savePoint(planA),
        productionPlan: { ...savePoint(planB).productionPlan },
      }
      await expect(repository.putExecutionSavePoint(mismatchedPlan)).rejects.toBeInstanceOf(RepositoryError)
      expect(await database.executionSavePoints.count()).toBe(0)
    })
  })
})
