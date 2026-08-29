import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntryStaleReason } from '../domain/models/publicTypes'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

function dependencies(staleReasons: BuildListEntryStaleReason[] = []): BuildListPageDependencies {
  const target = createValidTargetWeapon()
  const candidate = createValidBuildCandidate()
  candidate.searchStateHash = createSearchStateHash(candidate.route, createValidRngState(), [createValidNormalArtianCounter()])
  const entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.ui'), createdAt: '2026-08-29T03:00:00.000Z' })
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.isStale = staleReasons.length > 0
  entry.staleReasons = staleReasons
  return {
    master: createValidMasterDataFixture(),
    calculationContext: domainFixtureContext,
    refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [] })),
    deleteEntry: vi.fn(async () => undefined),
  }
}

describe('BuildListPage', () => {
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
