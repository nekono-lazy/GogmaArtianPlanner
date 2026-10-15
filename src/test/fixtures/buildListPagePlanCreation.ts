import { vi, type Mock } from 'vitest'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { CalculationContext } from '../../domain/models/publicTypes'
import type { PlannerInput, PlannerInputValidationResult, ValidatedBuildListEntry } from '../../domain/planner'
import type {
  BuildListOptimizationResult,
  BuildListOptimizationUnsupportedReason,
  PlanCreationMethodSelection,
} from '../../domain/planner/buildListOptimization'
import { createBuildListCalculationContext } from '../../services/buildList/createBuildListCalculationContext'
import {
  createBuildListOptimizationSession,
  type BuildListOptimizationStartSnapshot,
} from '../../services/planner/buildListOptimizationService'
import type {
  BuildListOptimizationRunHandle,
  BuildListOptimizationRunObserver,
  BuildListOptimizationRunOutcome,
  BuildListOptimizationWorkerClient,
} from '../../services/planner/buildListOptimizationWorkerClient'
import {
  createPlanCreationSession,
  type PlanCreationPreparation,
  type PlanCreationSession,
} from '../../services/planner/planCreationService'
import type { PlannerWorkerClient } from '../../services/planner/plannerWorkerClient'

/**
 * Plan creation sessions for the Build List page tests (Issue #260 PR-6C). They are the real `createPlanCreationSession()` - its
 * press, supersede, cancel and auxiliary rules are the Application's own - over a test preparer and test Worker Clients, so a page
 * test can say which judgement a press reads without a Master the page fixtures do not hold. The judgement itself
 * (`selectPlanCreationMethod()`) and the real start reader are tested in `planCreationService.test.ts`; the page's integration test
 * runs them for real.
 */

/** A validation stand-in naming `validCount` valid Entries (the page reads the count only). */
export function validationWith(input: PlannerInput, validCount: number): PlannerInputValidationResult {
  const entries = input.buildListEntries.slice(0, validCount)
  while (entries.length < validCount) entries.push(input.buildListEntries[0]!)
  return {
    isValid: true,
    issues: [],
    validConflictResolutions: [],
    validBuildListEntries: entries.map((entry) => ({ entry }) as unknown as ValidatedBuildListEntry),
    excludedBuildListEntries: [],
    excludedBuildListEntryWarnings: [],
    warnings: [],
  }
}

export const ordinarySelection = (input: PlannerInput): PlanCreationMethodSelection =>
  ({ kind: 'ordinary_planner', validation: validationWith(input, 1) })

export const optimizationSelection = (validCount = 2) => (input: PlannerInput): PlanCreationMethodSelection =>
  ({ kind: 'build_list_optimization', validation: validationWith(input, validCount) })

export const unsupportedSelection = (reasons: BuildListOptimizationUnsupportedReason[], ordinaryPlannerAuxiliary: boolean, validCount = 2) =>
  (input: PlannerInput): PlanCreationMethodSelection =>
    ({ kind: 'build_list_optimization_unsupported', validation: validationWith(input, validCount), reasons, ordinaryPlannerAuxiliary })

export const NO_DRAFT_SNAPSHOT: BuildListOptimizationStartSnapshot = Object.freeze({ observedDraftPlanId: null, runningPlanAbsent: true })

/** The Build List optimization Worker Client: every run is recorded and settles when the test says so. */
export function fakeBuildListOptimizationClient() {
  const runs: {
    input: PlannerInput
    observer?: BuildListOptimizationRunObserver
    requestId: string
    settle(outcome: BuildListOptimizationRunOutcome): void
    complete(result: BuildListOptimizationResult): void
    cancel: Mock<() => void>
  }[] = []
  const client: BuildListOptimizationWorkerClient = {
    run: vi.fn((input: PlannerInput, observer?: BuildListOptimizationRunObserver): BuildListOptimizationRunHandle => {
      const requestId = `optimization-run-${runs.length + 1}`
      let settle!: (outcome: BuildListOptimizationRunOutcome) => void
      const outcome = new Promise<BuildListOptimizationRunOutcome>((resolve) => {
        settle = resolve
      })
      const cancel = vi.fn<() => void>(() => settle({ status: 'cancelled', requestId, reason: 'cancelled' }))
      runs.push({ input, observer, requestId, settle, complete: (result) => settle({ status: 'completed', requestId, result }), cancel })
      return { requestId, outcome, cancel }
    }),
    cancel: vi.fn(() => runs.at(-1)?.cancel()),
    dispose: vi.fn(() => runs.at(-1)?.cancel()),
    getState: vi.fn(() => 'idle' as const),
  }
  return { client, runs }
}

export interface TestPlanCreationSessionOptions {
  /** The fresh input one read returns (called once per `inspect()` and per press). */
  createInput(): Promise<PlannerInput>
  /** The judgement over that input; the ordinary Planner by default. */
  select?(input: PlannerInput): PlanCreationMethodSelection
  /** Replaces the judged read altogether (a read failure, a running Plan, ...). */
  prepare?(): Promise<PlanCreationPreparation>
  createPlannerClient(): PlannerWorkerClient
  createOptimizationClient?(): BuildListOptimizationWorkerClient
  startSnapshot?: BuildListOptimizationStartSnapshot
}

export function createTestPlanCreationSession(options: TestPlanCreationSessionOptions): PlanCreationSession {
  let requestSequence = 0
  return createPlanCreationSession({
    preparer: {
      prepare: options.prepare ?? (async (): Promise<PlanCreationPreparation> => {
        try {
          const plannerInput = await options.createInput()
          return {
            kind: 'judged',
            plannerInput,
            startSnapshot: options.startSnapshot ?? NO_DRAFT_SNAPSHOT,
            selection: (options.select ?? ordinarySelection)(plannerInput),
          }
        } catch (error: unknown) {
          return { kind: 'start_read_failed', code: 'transaction_failed', message: error instanceof Error ? error.message : String(error) }
        }
      }),
    },
    optimization: createBuildListOptimizationSession({
      startReader: { read: () => Promise.reject(new Error('The optimization never reads the state itself here.')) },
      createClient: options.createOptimizationClient ?? (() => {
        throw new Error('The Build List optimization is not expected in this test.')
      }),
    }),
    createPlannerClient: options.createPlannerClient,
    createRequestId: () => `page-planner-request-${++requestSequence}`,
  })
}

/**
 * The plan creation members of `BuildListPageDependencies` for a page test that does not exercise the optimization: an ordinary
 * Planner session over `createInput` (read with the current CalculationContext, as the real start reader reads it), and adoption
 * calls that refuse.
 */
export function testPlanCreationDependencies(
  master: MasterDataRoot,
  createPlannerClient: () => PlannerWorkerClient,
  createInput: (calculationContext: CalculationContext) => Promise<PlannerInput>,
) {
  return {
    createPlanCreationSession: () => createTestPlanCreationSession({
      createInput: () => createInput(createBuildListCalculationContext(master)),
      createPlannerClient,
    }),
    inspectBuildListOptimizationAdoption: vi.fn(() => Promise.reject(new Error('adoption is not expected in this test'))),
    saveBuildListOptimizationAdoption: vi.fn(() => Promise.reject(new Error('adoption is not expected in this test'))),
  }
}
