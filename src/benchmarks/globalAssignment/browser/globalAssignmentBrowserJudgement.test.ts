import { describe, expect, it } from 'vitest'
import { judgeD1aRun, type D0cIdentityComparison, type D1aFreshProcessView, type D1aVerdict } from '../verificationProtocol'
import type { PlannerVerificationSemantic } from '../verify'
import {
  gabUnmeasuredReason, judgeBrowserLogicalRun,
  type GabFreshWorkerView, type GabLogicalRunVerdict, type GabVerificationView, type GabWorkerSettle,
} from './globalAssignmentBrowserJudgement'
import { runFirstStage, runFreshStage } from './globalAssignmentBrowserStages'
import { SYNTHETIC_CONDITIONS, syntheticExport, syntheticPorts, syntheticProvenance } from './globalAssignmentBrowserTestFixture'

/*
 * Issue #154 Production準備 P-1 (design 12.1): the Browser logical-run judgement keeps the D-1A `judgeD1aRun()` order and meanings.
 * Wherever both apply (no integrity issue, a completed first Worker with a verification), its verdict is D-1A's with `verified`
 * renamed `browser_nonformal_conditions_met` and the Browser settlement kept beside an `unmeasured` reason. Integrity issues come first;
 * a request that did not complete (a cancel above all) is never a measurement; nothing is ever `verified`, accepted or proven.
 */

async function semantics() {
  const source = await syntheticExport()
  const run = async (researchMaxPlanSteps: number) => {
    const conditions = { ...SYNTHETIC_CONDITIONS, verification: { researchMaxPlanSteps, verificationBudget: 1 } }
    const first = await runFirstStage(conditions, syntheticProvenance(source), syntheticPorts(source))
    const fresh = await runFreshStage(first.entrySet!.value, conditions, syntheticProvenance(source), syntheticPorts(source))
    return { first, fresh }
  }
  const met = await run(20_000)
  const truncated = await run(1)
  const otherBound = await run(20_001)
  const view = (verification: { semantic: PlannerVerificationSemantic; semanticSha256: string } | null): GabVerificationView => ({ semantic: verification!.semantic, semanticSha256: verification!.semanticSha256 })
  return {
    met: view(met.first.verification), metFresh: view(met.fresh.verification), truncated: view(truncated.first.verification), otherBound: view(otherBound.fresh.verification),
    phase0: met.fresh.phase0.planningTargetIdsSorted!, materializationOutcome: met.first.materialization!.semantic.outcome,
  }
}

const MATCHED_IDENTITY: D0cIdentityComparison = {
  matched: true, issues: [], semanticSha256: { recomputed: 'x', expected: 'x', matched: true },
  entryFingerprint: { fromSemanticRecord: 'x', fromHandoff: 'x', expected: 'x', matched: true, handoffMatchesRecord: true }, candidates: 1, handoffs: 1, semanticIntegrityIssues: 0,
}

/** D-1A's verdict for the same views, in the Browser's vocabulary (the only renaming the design allows). */
function asBrowser(verdict: D1aVerdict, browserSettle: (run: 'first' | 'fresh') => GabWorkerSettle | 'not_run'): GabLogicalRunVerdict {
  if (verdict.kind === 'verified') {
    const { kind: _verified, ...rest } = verdict
    void _verified
    return { kind: 'browser_nonformal_conditions_met', ...rest }
  }
  if (verdict.kind === 'unmeasured') return { ...verdict, browserSettle: browserSettle(verdict.run) }
  return verdict as GabLogicalRunVerdict
}

const SETTLES: GabWorkerSettle[] = ['completed', 'cancelled', 'cancelled_terminated', 'timeout', 'worker_error', 'worker_reported_error', 'page_left', 'page_lost', 'out_of_memory', 'environment_unsupported']

describe('P-1 judgement: D-1A order and meanings', () => {
  it('agrees with judgeD1aRun() on every combination where both apply (verified renamed, settlement kept)', async () => {
    const s = await semantics()
    const withOutcome = (base: GabVerificationView, outcome: PlannerVerificationSemantic['outcome']): GabVerificationView => ({ semantic: { ...base.semantic, outcome }, semanticSha256: `${base.semanticSha256}:${outcome.kind}` })
    const firsts: GabVerificationView[] = [
      s.met, s.truncated,
      withOutcome(s.met, { kind: 'materialization_unconfirmed', targetWeaponId: 't', outcomeKind: 'unconfirmed', outcomeReason: 'x' }),
      withOutcome(s.met, { kind: 'objective_mismatch', physicalOperations: 5, objective: 6, reasons: [] }),
      withOutcome(s.met, { kind: 'unmeasured', reason: 'cancelled' }),
    ]
    const freshes: GabFreshWorkerView[] = [
      { settle: 'completed', phase0PlanningTargetIds: s.phase0, verification: s.metFresh },
      { settle: 'completed', phase0PlanningTargetIds: s.phase0, verification: s.truncated },
      { settle: 'completed', phase0PlanningTargetIds: s.phase0, verification: s.otherBound },
      { settle: 'completed', phase0PlanningTargetIds: [s.phase0[0]!], verification: s.metFresh },
      { settle: 'completed', phase0PlanningTargetIds: [...s.phase0, 'target.fixture.z'], verification: s.metFresh },
      { settle: 'completed', phase0PlanningTargetIds: null, verification: null },
      { settle: 'not_run', phase0PlanningTargetIds: null, verification: null },
      ...SETTLES.filter(settle => settle !== 'completed' && settle !== 'environment_unsupported').map(settle => ({ settle, phase0PlanningTargetIds: null, verification: null }) as GabFreshWorkerView),
    ]
    let compared = 0
    for (const firstVerification of firsts) {
      for (const fresh of freshes) {
        const browser = judgeBrowserLogicalRun({ settle: 'completed', materializationOutcome: s.materializationOutcome, verification: firstVerification }, fresh, [])
        const freshProcess: D1aFreshProcessView['process'] = fresh.settle === 'completed' || fresh.settle === 'not_run' ? fresh.settle : gabUnmeasuredReason(fresh.settle) as D1aFreshProcessView['process']
        const d1a = judgeD1aRun({ process: 'completed', identity: MATCHED_IDENTITY, verification: firstVerification }, { process: freshProcess, phase0PlanningTargetIds: fresh.phase0PlanningTargetIds, verification: fresh.verification }, [])
        expect(browser.verdict).toEqual(asBrowser(d1a.verdict, run => (run === 'first' ? 'completed' : fresh.settle)))
        expect(browser.crossWorker).toEqual(d1a.crossProcess)
        compared += 1
      }
    }
    expect(compared).toBe(firsts.length * freshes.length)
  }, 120_000)

  it('maps every Browser settlement to the design 7.11 reason, keeping the Browser classification', () => {
    expect(Object.fromEntries(SETTLES.filter(settle => settle !== 'completed').map(settle => [settle, gabUnmeasuredReason(settle as Exclude<GabWorkerSettle, 'completed'>)]))).toEqual({
      cancelled: 'cancelled', cancelled_terminated: 'cancelled', page_left: 'cancelled', timeout: 'timeout', out_of_memory: 'out_of_memory',
      worker_error: 'process_failure', worker_reported_error: 'process_failure', page_lost: 'process_failure', environment_unsupported: 'environment_unsupported',
    })
  })

  it('puts integrity first, never measures an uncompleted (cancelled) request, and never claims a formal status', async () => {
    const s = await semantics()
    const met = { settle: 'completed' as const, materializationOutcome: s.materializationOutcome, verification: s.met }
    const freshMet: GabFreshWorkerView = { settle: 'completed', phase0PlanningTargetIds: s.phase0, verification: s.metFresh }
    const conditionsMet = judgeBrowserLogicalRun(met, freshMet, [])
    expect(conditionsMet.verdict.kind).toBe('browser_nonformal_conditions_met')
    // Any integrity issue wins over two Workers that met every condition.
    expect(judgeBrowserLogicalRun(met, freshMet, ['first: export_changed']).verdict).toEqual({ kind: 'invalid_run_integrity', issues: ['first: export_changed'] })
    // A cancelled request is unmeasured even with a (discarded) result-shaped view: cancellation never becomes a measurement.
    for (const settle of ['cancelled', 'cancelled_terminated', 'page_left'] as const) {
      expect(judgeBrowserLogicalRun({ ...met, settle }, freshMet, []).verdict).toEqual({ kind: 'unmeasured', run: 'first', reason: 'cancelled', browserSettle: settle })
      expect(judgeBrowserLogicalRun(met, { ...freshMet, settle }, []).verdict).toEqual({ kind: 'unmeasured', run: 'fresh', reason: 'cancelled', browserSettle: settle })
    }
    // A completed first Worker without Phase D': the materialization's own outcome, or process_failure when even that is missing.
    expect(judgeBrowserLogicalRun({ settle: 'completed', materializationOutcome: { kind: 'no_structural_candidate', reason: 'x' }, verification: null }, { settle: 'not_run', phase0PlanningTargetIds: null, verification: null }, []).verdict)
      .toEqual({ kind: 'phase_d_prime_not_reached', run: 'first', materializationOutcome: { kind: 'no_structural_candidate', reason: 'x' } })
    expect(judgeBrowserLogicalRun({ settle: 'completed', materializationOutcome: null, verification: null }, { settle: 'not_run', phase0PlanningTargetIds: null, verification: null }, []).verdict)
      .toEqual({ kind: 'unmeasured', run: 'first', reason: 'process_failure', browserSettle: 'completed' })
    // The labels: browser_nonformal_* only, never verified / nonformal_planner_verified / accepted / proven.
    const labels = [conditionsMet, judgeBrowserLogicalRun(met, freshMet, ['x']), judgeBrowserLogicalRun({ ...met, settle: 'timeout' }, freshMet, [])].map(judgement => judgement.recordClassification)
    expect(labels).toEqual(['browser_nonformal_conditions_met', 'browser_nonformal_invalid_run_integrity', 'browser_nonformal_unmeasured'])
    expect(JSON.stringify(conditionsMet)).not.toMatch(/"verified"|nonformal_planner_verified|"accepted"|proven_minimum|best_found/)
    expect(conditionsMet).toMatchObject({ formal: false, formalValidity: 'not_claimed', acceptance: 'not_claimed', minimality: 'not_claimed' })
  }, 120_000)
})
