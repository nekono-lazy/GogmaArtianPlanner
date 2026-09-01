import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntryStaleReason } from '../domain/models/publicTypes'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerOptions, type PlannerInput } from '../domain/planner'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

function createPlannerClient(): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(async () => ({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
    })),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function dependencies(
  staleReasons: BuildListEntryStaleReason[] = [],
  client: PlannerWorkerClient = createPlannerClient(),
): BuildListPageDependencies {
  const target = createValidTargetWeapon()
  const candidate = createValidBuildCandidate()
  candidate.searchStateHash = createSearchStateHash(candidate.route, createValidRngState(), [createValidNormalArtianCounter()])
  const entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.ui'), createdAt: '2026-08-29T03:00:00.000Z' })
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.isStale = staleReasons.length > 0
  entry.staleReasons = staleReasons
  return {
    master: createValidMasterDataFixture(),
    createWorkerClient: () => client,
    refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [] })),
    createInput: vi.fn(async (calculationContext): Promise<PlannerInput> => ({
      rngState: createValidRngState(),
      normalCounters: [createValidNormalArtianCounter()],
      ownedWeapons: [],
      targetWeapons: [target],
      buildListEntries: [createValidBuildListEntry()],
      calculationContext,
      options: { ...defaultPlannerOptions },
      master: {
        weaponBonusDefinitions: [],
        weaponTypes: [],
        elements: [],
        bonusTypes: [],
        bonusRanks: [],
        lotteries: [],
        materialCosts: [],
      },
      conflictResolutions: [],
    })),
    savePlan: vi.fn(async () => undefined),
    deleteEntry: vi.fn(async () => undefined),
  }
}

describe('BuildListPage', () => {
  it('uses the Production RNG version as the current staleness authority', () => {
    expect(createBuildListCalculationContext(createValidMasterDataFixture()).rngEngineVersion)
      .toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('executes the Production Planner client path and persists the returned draft Plan', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    const deps = dependencies([], client)
    render(<BuildListPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(deps.refresh).toHaveBeenCalledWith(expect.objectContaining({
      rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    }))
    expect(deps.createInput).toHaveBeenCalledWith(expect.objectContaining({
      rngEngineVersion: client.engineVersion,
    }))
    expect(client.createPlan).toHaveBeenCalledOnce()
    expect(deps.savePlan).toHaveBeenCalledWith(expect.objectContaining({
      id: createValidProductionPlan().id,
      status: 'draft',
    }))
    expect(await screen.findByText(/生産計画を作成しました/)).toBeInTheDocument()
  })

  it('renders from Candidate Snapshot and shows stale reasons', async () => {
    render(<BuildListPage dependencies={dependencies(['rng_state_changed'])} />)
    expect(await screen.findByText('Domain fixture target')).toBeInTheDocument()
    expect(screen.getByText('再検索が必要')).toBeInTheDocument()
    expect(screen.getByText('RNG状態が検索時から変更されています')).toBeInTheDocument()
    expect(screen.getByText('実用')).toBeInTheDocument()
  })

  it('removes only the Build List entry', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    render(<BuildListPage dependencies={deps} />)
    await user.click(await screen.findByRole('button', { name: 'ビルドリストから削除' }))
    expect(deps.deleteEntry).toHaveBeenCalledOnce()
    expect(screen.queryByText('Domain fixture target')).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    const deps = dependencies()
    deps.refresh = vi.fn(async () => ({ entries: [], targets: [], ownedWeapons: [] }))
    render(<BuildListPage dependencies={deps} />)
    expect(await screen.findByText('ビルドリストは空です。検索結果から候補を追加してください。')).toBeInTheDocument()
  })
})
