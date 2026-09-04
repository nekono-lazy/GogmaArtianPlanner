import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createInitialRngState } from '../domain/models/factories'
import { loadMasterData } from '../domain/master/loadMasterData'
import { getEnabledElements, getEnabledWeaponTypes } from '../domain/master/masterSelectors'
import type { RngState } from '../domain/models/publicTypes'
import type {
  CompleteSkillObservation,
  GogmaCounterIdentificationResult,
  SkillIdentificationInput,
  SkillIdentificationResult,
} from '../domain/rng/identification'
import {
  REFERENCE_GROUP_SKILL_POOL,
  REFERENCE_SERIES_SKILL_POOL,
} from '../domain/rng/production/referenceSkillPools'
import type { GogmaCounterIdentificationWorkerClient } from '../services/rngIdentification/gogmaCounterIdentificationWorkerClient'
import type { SkillIdentificationWorkerClient } from '../services/rngIdentification/skillIdentificationWorkerClient'
import {
  DefaultIdentificationWizardCoordinator,
  type IdentificationAdoptionPort,
  type IdentificationWizardCoordinator,
} from '../services/rngIdentification/identificationWizardCoordinator'
import { RngSetupPage, type RngSetupPageDependencies } from './RngSetupPage'

const WIZARD_DIALOG = { name: 'RNG Identification Wizard' } as const

class ControllableSkillClient implements SkillIdentificationWorkerClient {
  readonly engineVersion = 'test-skill-client'
  disposeCalls = 0
  cancelledRequestIds: string[] = []
  activeRequestIds = new Set<string>()

  identify(requestId: string): Promise<SkillIdentificationResult> {
    this.activeRequestIds.add(requestId)
    return new Promise<SkillIdentificationResult>(() => {})
  }

  cancel(requestId: string): void {
    this.cancelledRequestIds.push(requestId)
    this.activeRequestIds.delete(requestId)
  }

  dispose(): void {
    this.disposeCalls += 1
    this.activeRequestIds.clear()
  }
}

class ControllableGogmaClient implements GogmaCounterIdentificationWorkerClient {
  readonly engineVersion = 'test-gogma-client'
  disposeCalls = 0
  cancelledRequestIds: string[] = []

  identify(): Promise<GogmaCounterIdentificationResult> {
    return new Promise<GogmaCounterIdentificationResult>(() => {})
  }

  cancel(requestId: string): void {
    this.cancelledRequestIds.push(requestId)
  }

  dispose(): void {
    this.disposeCalls += 1
  }
}

interface CoordinatorFixture {
  readonly coordinator: IdentificationWizardCoordinator
  readonly skillClient: ControllableSkillClient
  readonly gogmaClient: ControllableGogmaClient
}

function fixture(initial = createInitialRngState('2026-09-01T00:00:00.000Z')) {
  let stored = initial
  const created: CoordinatorFixture[] = []
  const adoptionService: IdentificationAdoptionPort = {
    adopt: vi.fn(async () => stored),
  }
  const deps: RngSetupPageDependencies = {
    ensure: vi.fn(async () => stored),
    save: vi.fn(async (state: RngState) => { stored = state; return state }),
    getNormalCounters: vi.fn(async () => []),
    createIdentificationCoordinator: () => {
      const skillClient = new ControllableSkillClient()
      const gogmaClient = new ControllableGogmaClient()
      const coordinator = new DefaultIdentificationWizardCoordinator({
        skillClient, gogmaClient, adoptionService,
      })
      created.push({ coordinator, skillClient, gogmaClient })
      return coordinator
    },
  }
  return { deps, created }
}

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data

function skillIdentificationInput(): SkillIdentificationInput {
  const weaponType = getEnabledWeaponTypes(master)[0]
  const element = getEnabledElements(master)[0]
  const observation: CompleteSkillObservation = {
    seriesSkillId: REFERENCE_SERIES_SKILL_POOL[0],
    groupSkillId: REFERENCE_GROUP_SKILL_POOL[0],
  }
  return {
    weaponTypeId: weaponType.id,
    elementId: element.id,
    observations: [observation, observation, observation, observation],
    skillCounterRange: { startInclusive: 0, endInclusive: 10 },
    seedRange: { startInclusive: 0, endInclusive: 100 },
  }
}

describe('RngSetupPage Identification Wizard lifecycle', () => {
  it('opens the Wizard under React StrictMode without disposing the live Coordinator', async () => {
    const user = userEvent.setup()
    const { deps, created } = fixture()
    render(<StrictMode><RngSetupPage dependencies={deps} /></StrictMode>)

    await screen.findByLabelText('Base Seed（基準シード）')
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))

    expect(screen.getByRole('dialog', WIZARD_DIALOG)).toBeInTheDocument()
    expect(created).toHaveLength(1)
    expect(created[0].coordinator.getState().disposed).toBe(false)
    expect(created[0].skillClient.disposeCalls).toBe(0)
    expect(created[0].gogmaClient.disposeCalls).toBe(0)
  })

  it('keeps the StrictMode-mounted Wizard subscribed to Coordinator state updates', async () => {
    const user = userEvent.setup()
    const { deps, created } = fixture()
    render(<StrictMode><RngSetupPage dependencies={deps} /></StrictMode>)

    await screen.findByLabelText('Base Seed（基準シード）')
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))

    const { coordinator, skillClient } = created[0]
    const cancelStep1 = screen.getByRole('button', { name: 'STEP 1 Cancel' })
    expect(cancelStep1).toBeDisabled()

    // A Coordinator publish must still reach the Dialog after the StrictMode effect replay.
    act(() => { void coordinator.identifySkill(skillIdentificationInput()) })
    expect(cancelStep1).toBeEnabled()
    expect(skillClient.activeRequestIds.size).toBe(1)

    // Cancel propagation through the live subscription remains intact.
    await user.click(cancelStep1)
    expect(skillClient.cancelledRequestIds).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'STEP 1 Cancel' })).toBeDisabled()
    expect(coordinator.getState().disposed).toBe(false)
  })

  it('disposes the Coordinator and its Worker Clients when the user really closes the Wizard', async () => {
    const user = userEvent.setup()
    const { deps, created } = fixture()
    render(<StrictMode><RngSetupPage dependencies={deps} /></StrictMode>)

    await screen.findByLabelText('Base Seed（基準シード）')
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog', WIZARD_DIALOG)).not.toBeInTheDocument()
    expect(created[0].coordinator.getState().disposed).toBe(true)
    expect(created[0].skillClient.disposeCalls).toBe(1)
    expect(created[0].gogmaClient.disposeCalls).toBe(1)
  })

  it('reopens the Wizard with a new Coordinator after a real close', async () => {
    const user = userEvent.setup()
    const { deps, created } = fixture()
    render(<StrictMode><RngSetupPage dependencies={deps} /></StrictMode>)

    await screen.findByLabelText('Base Seed（基準シード）')
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))

    expect(screen.getByRole('dialog', WIZARD_DIALOG)).toBeInTheDocument()
    expect(created).toHaveLength(2)
    expect(created[0].coordinator).not.toBe(created[1].coordinator)
    expect(created[1].coordinator.getState().disposed).toBe(false)
  })

  it('disposes the Coordinator when the owning page unmounts while the Wizard is open', async () => {
    const user = userEvent.setup()
    const { deps, created } = fixture()
    const view = render(<StrictMode><RngSetupPage dependencies={deps} /></StrictMode>)

    await screen.findByLabelText('Base Seed（基準シード）')
    await user.click(screen.getByRole('button', { name: 'Identification Wizardを開始' }))
    expect(created[0].coordinator.getState().disposed).toBe(false)

    view.unmount()

    expect(created[0].coordinator.getState().disposed).toBe(true)
    expect(created[0].skillClient.disposeCalls).toBe(1)
    expect(created[0].gogmaClient.disposeCalls).toBe(1)
  })
})
