import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ExecutionRuntimeError,
  PlanBreakingChangeApprovalRequiredError,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../../domain/execution'
import { createInitialRngState } from '../../domain/models/factories'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { RngState } from '../../domain/models/publicTypes'
import type {
  IdentificationWizardCoordinator,
  IdentificationWizardState,
  IdentificationWizardStateListener,
} from '../../services/rngIdentification/identificationWizardCoordinator'
import { planBreakingApproval, planBreakingInspection } from '../../test/fixtures/planBreakingInspection'
import { IdentificationWizardDialog } from './IdentificationWizardDialog'

/**
 * The Wizard's adoption behind the breaking-change warning (`docs/UI_FLOW.md`
 * 16.3): the warning is nested above the Wizard Dialog, a cancel keeps the
 * review and the game-restored confirmation, and the approval reaches the
 * Coordinator's own adoption. The 「調査前のゲーム状態へ戻した」 confirmation stays
 * the Identification's own and is never mistaken for the save point one.
 */

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const master = loadedMaster.data

const WARNING = { name: '実行中の生産計画があります' } as const
const REVIEW = { baseSeed: '86315169', startingSkillCounter: 42, startingGogmaCounter: 84 }

function adoptedState(): RngState {
  return {
    ...createInitialRngState('2026-09-01T00:00:00.000Z'),
    baseSeed: { value: REVIEW.baseSeed, isConfirmed: true, source: 'observation' },
    skillCounter: { value: REVIEW.startingSkillCounter, isConfirmed: true, source: 'observation' },
    gogmaCounter: { value: REVIEW.startingGogmaCounter, isConfirmed: true, source: 'observation' },
    lastIdentifiedAt: '2026-09-18T00:00:00.000Z',
  }
}

/** A Coordinator already holding a complete, unique review. */
class ReviewedCoordinator implements IdentificationWizardCoordinator {
  state: IdentificationWizardState = {
    skill: {
      status: 'completed', requestId: null, input: null, progress: null, result: null,
      classification: 'unique', identified: { baseSeed: REVIEW.baseSeed, startingSkillCounter: REVIEW.startingSkillCounter }, error: null,
    },
    gogma: {
      status: 'completed', requestId: null, input: null, progress: null, result: null,
      classification: 'unique', startingGogmaCounter: REVIEW.startingGogmaCounter, error: null,
    },
    review: { ...REVIEW },
    gameRestoredConfirmed: false,
    adoption: { status: 'idle', savedRngState: null, error: null },
    disposed: false,
  }
  listeners = new Set<IdentificationWizardStateListener>()
  inspectAdoption = vi.fn(async (): Promise<PlanBreakingChangeInspection> => ({ approvalRequired: false }))
  adoptImplementation: (approval: PlanBreakingChangeApproval | null) => Promise<RngState> = async () => adoptedState()
  adopt = vi.fn(async (approval: PlanBreakingChangeApproval | null = null): Promise<RngState> => {
    if (!this.state.gameRestoredConfirmed) throw new Error('confirmation_required')
    this.publish({ ...this.state, adoption: { status: 'adopting', savedRngState: null, error: null } })
    try {
      const saved = await this.adoptImplementation(approval)
      this.publish({ ...this.state, adoption: { status: 'adopted', savedRngState: saved, error: null } })
      return saved
    } catch (error) {
      // As the real Coordinator: a missing-approval refusal returns to idle.
      this.publish({
        ...this.state,
        adoption: error instanceof PlanBreakingChangeApprovalRequiredError
          ? { status: 'idle', savedRngState: null, error: null }
          : { status: 'error', savedRngState: null, error: { kind: 'adoption_error', error } },
      })
      throw error
    }
  })

  getState() { return this.state }
  subscribe(listener: IdentificationWizardStateListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(next: IdentificationWizardState) {
    this.state = next
    for (const listener of [...this.listeners]) listener(next)
  }
  setGameRestoredConfirmed(value: boolean) {
    this.publish({ ...this.state, gameRestoredConfirmed: value })
  }
  identifySkill(): never { throw new Error('not expected') }
  identifyGogma(): never { throw new Error('not expected') }
  cancelSkill(): void {}
  cancelGogma(): void {}
  restart(): void {}
  dispose(): void {}
}

function renderWizard() {
  const coordinator = new ReviewedCoordinator()
  const onAdopted = vi.fn()
  render(
    <IdentificationWizardDialog
      coordinator={coordinator}
      initialRngState={createInitialRngState('2026-09-01T00:00:00.000Z')}
      master={master}
      onAdopted={onAdopted}
      onClose={vi.fn()}
    />,
  )
  return { coordinator, onAdopted }
}

const adoptButton = () => screen.getByRole('button', { name: 'Adopt starting values' })
const restoredCheckbox = () => screen.getByRole('checkbox', { name: '調査前のゲーム状態へ戻した' })

describe('IdentificationWizardDialog breaking-change warning', () => {
  it('warns above the Wizard and keeps the review and the game-restored confirmation on cancel', async () => {
    const user = userEvent.setup()
    const { coordinator, onAdopted } = renderWizard()
    coordinator.inspectAdoption.mockResolvedValue(planBreakingInspection({ reasons: ['rng_state_changed'] }))
    await user.click(restoredCheckbox())
    await user.click(adoptButton())

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(warning.getByText('Identification結果を採用すると、現在の生産計画で使用している予測位置と一致しなくなります。')).toBeInTheDocument()
    expect(warning.getByText('RNG状態が変わります')).toBeInTheDocument()
    // Both dialogs exist; the Wizard stays mounted underneath.
    expect(screen.getByRole('dialog', { name: 'RNG Identification Wizard', hidden: true })).toBeInTheDocument()
    await user.click(warning.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog', WARNING)).toBeNull())
    expect(coordinator.adopt).not.toHaveBeenCalled()
    expect(onAdopted).not.toHaveBeenCalled()
    expect(screen.getByText('Base Seed: 86315169')).toBeInTheDocument()
    expect(restoredCheckbox()).toBeChecked()
    expect(adoptButton()).toBeEnabled()
    expect(coordinator.getState().adoption.status).toBe('idle')
  })

  it('adopts with the approval built from the inspection and reports the abandoned Plan', async () => {
    const user = userEvent.setup()
    const { coordinator, onAdopted } = renderWizard()
    const inspection = planBreakingInspection()
    coordinator.inspectAdoption.mockResolvedValue(inspection)
    await user.click(restoredCheckbox())
    await user.click(adoptButton())
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    await waitFor(() => expect(onAdopted).toHaveBeenCalledTimes(1))
    expect(coordinator.adopt).toHaveBeenCalledWith(planBreakingApproval(inspection))
    expect(onAdopted).toHaveBeenCalledWith(expect.objectContaining({ lastIdentifiedAt: '2026-09-18T00:00:00.000Z' }), { planAbandoned: true })
    expect(await screen.findByText('Identification結果をRNG状態へ採用しました。')).toBeInTheDocument()
  })

  it('promotes an adoption refused for a missing approval to the warning and retries with it', async () => {
    const user = userEvent.setup()
    const { coordinator, onAdopted } = renderWizard()
    const inspection = planBreakingInspection()
    let calls = 0
    coordinator.adoptImplementation = async (approval) => {
      calls += 1
      if (approval === null) throw new PlanBreakingChangeApprovalRequiredError(inspection)
      return adoptedState()
    }
    await user.click(restoredCheckbox())
    await user.click(adoptButton())

    const warning = within(await screen.findByRole('dialog', WARNING))
    expect(screen.queryByText(/Adoption failure/)).toBeNull()
    await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))
    await waitFor(() => expect(onAdopted).toHaveBeenCalledWith(expect.anything(), { planAbandoned: true }))
    expect(calls).toBe(2)
    expect(coordinator.adopt).toHaveBeenLastCalledWith(planBreakingApproval(inspection))
  })

  it('reports a runtime refusal in Japanese and keeps the review for another try', async () => {
    const user = userEvent.setup()
    const { coordinator, onAdopted } = renderWizard()
    coordinator.inspectAdoption.mockResolvedValue(planBreakingInspection())
    coordinator.adoptImplementation = async () => {
      throw new ExecutionRuntimeError('plan_breaking_change_state_changed', 'moved on')
    }
    await user.click(restoredCheckbox())
    await user.click(adoptButton())
    await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

    expect(await screen.findByText(/確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。/)).toBeInTheDocument()
    expect(screen.queryByText(/moved on/)).toBeNull()
    expect(onAdopted).not.toHaveBeenCalled()
    expect(restoredCheckbox()).toBeChecked()
    expect(adoptButton()).toBeEnabled()
  })

  it('reports a refusal raised by the inspection itself', async () => {
    const user = userEvent.setup()
    const { coordinator } = renderWizard()
    coordinator.inspectAdoption.mockRejectedValue(new ExecutionRuntimeError('running_plan_invariant_violated', 'two'))
    await user.click(restoredCheckbox())
    await user.click(adoptButton())

    expect(await screen.findByText(/実行中の生産計画が複数存在するため保存できません。/)).toBeInTheDocument()
    expect(coordinator.adopt).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', WARNING)).toBeNull()
  })
})
