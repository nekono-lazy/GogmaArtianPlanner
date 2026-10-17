import { describe, expect, it } from 'vitest'
import { hashStableValue, stableStringify } from '../models/publicTypes'
import type { CalculationContext } from '../models/publicTypes'
import {
  expectRejectedRecordsCopyTheInput,
  withoutIssue121RejectedRecordFields,
} from '../../test/fixtures/rejectedRecordProjection'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import {
  createDeterministicPlannerDependencies,
  createPlannerSchedulerWorkloadInput,
} from '../../test/fixtures/plannerSchedulerWorkloads'
import { createProductionPlanWithObserver } from './productionPlanGeneration'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerResult,
  PlannerRunBuildListContext,
} from './plannerTypes'

/**
 * Issue #278 PR-2 (`docs/PLANNER_SPEC.md` 9.6.4 / 9.6.10): for an input without
 * explicit conflict resolutions - the Build List's ordinary run, the Build List
 * optimization's final verification and the replan Preview - the ordinary
 * Planner plans exactly as calculation schema 17 did. That is the premise of
 * the one ProductionPlan exception `18 -> 17`.
 *
 * The digests below were recorded by running this very file against the
 * calculation schema 17 code (`origin/main` f5e4811) and are compared here
 * against the current code. Every CalculationContext of the input is pinned to
 * schema 17 on both sides, so the two runs read one identical input; the
 * digest covers the whole `PlannerResult` - Plan, Steps, Conflicts, rejected
 * Entries, warnings and termination - except the two rejected-record fields
 * Issue #121 added later, which schema 17 never wrote (`schema17Projection()`).
 */

const RECORDED_DIGESTS: Record<string, { hash: string; length: number }> = {
  'catalogue:A-independent-lanes': { hash: 'fnv1a32:bb4ae790', length: 436369 },
  'catalogue:B-one-gogma-stream': { hash: 'fnv1a32:c37d51b8', length: 346672 },
  'catalogue:C-required-and-skippable': { hash: 'fnv1a32:7f3557ba', length: 149748 },
  'catalogue:D-unresolved-conflict': { hash: 'fnv1a32:36c8c2d0', length: 147569 },
  'catalogue:D-equal-priority': { hash: 'fnv1a32:8f088571', length: 147574 },
  'catalogue:E-shared-physical-action': { hash: 'fnv1a32:db381524', length: 4421 },
  'catalogue:F-transient-collision': { hash: 'fnv1a32:dcf4c0a1', length: 36758 },
  'catalogue:F-transient-executor': { hash: 'fnv1a32:a1170d3c', length: 53414 },
  'catalogue:G-bonus-first': { hash: 'fnv1a32:04b64cab', length: 29942 },
  'catalogue:G-skill-first': { hash: 'fnv1a32:5959b14b', length: 29892 },
  'catalogue:G-planner': { hash: 'fnv1a32:f96b520d', length: 29892 },
  'catalogue:G-preferred-lane-waits': { hash: 'fnv1a32:f9a55427', length: 21547 },
  'catalogue:H-checkpoint-pin': { hash: 'fnv1a32:6349ee70', length: 16069 },
  'catalogue:H-checkpoint-lanes': { hash: 'fnv1a32:bddb9fd8', length: 13196 },
  'catalogue:I-not-preferred-source': { hash: 'fnv1a32:9f0d4098', length: 10025 },
  'catalogue:J-same-owned-weapon': { hash: 'fnv1a32:d48f6e93', length: 10793 },
  'catalogue:K-predicted-forge': { hash: 'fnv1a32:426b4dfa', length: 23944 },
  'catalogue:K-blind-waits': { hash: 'fnv1a32:381973a7', length: 17076 },
  'catalogue:K-blind-unconfirmed': { hash: 'fnv1a32:fa5e5e81', length: 7896 },
  'catalogue:M-temporary-replacement': { hash: 'fnv1a32:2e44027a', length: 18668 },
  'catalogue:zero-operation': { hash: 'fnv1a32:f9f898ff', length: 4572 },
  'catalogue:deadlock': { hash: 'fnv1a32:f365c2c8', length: 33462 },
  'catalogue:true-deadlock': { hash: 'fnv1a32:ea44b8cf', length: 13147 },
  'catalogue:cross-satisfaction': { hash: 'fnv1a32:9d3d95e1', length: 10071 },
  'catalogue:dynamic-commitment': { hash: 'fnv1a32:1a5c631c', length: 61620 },
  'catalogue:committed-only-sharing': { hash: 'fnv1a32:4fdd3f39', length: 5043 },
  'catalogue:pinned-past': { hash: 'fnv1a32:4f4e3544', length: 11108 },
  'catalogue:pinned-past-lost-holding': { hash: 'fnv1a32:0f9c3b3a', length: 7762 },
  'catalogue:exact-bounds-expanded': { hash: 'fnv1a32:bb4ae790', length: 436369 },
  'catalogue:exact-bounds-steps': { hash: 'fnv1a32:1848a9b2', length: 436460 },
  'catalogue:bounded-max-plan-steps': { hash: 'fnv1a32:092d59f5', length: 58411 },
  'catalogue:bounded-max-expanded-states': { hash: 'fnv1a32:c37d51b8', length: 346672 },
  'catalogue:malformed-legacy-duplicate': { hash: 'fnv1a32:b46dfec8', length: 434 },
  'catalogue:empty-build-list': { hash: 'fnv1a32:47e0edd7', length: 288 },
  'workload:sanity-3': { hash: 'fnv1a32:c9d84fe5', length: 21546 },
  'workload:representative-12': { hash: 'fnv1a32:d9532d42', length: 907047 },
  'workload:representative-35': { hash: 'fnv1a32:313bcdc0', length: 1060791 },
}

function pinToSchema17(context: CalculationContext) {
  context.appSchemaVersion = 17
}

function schema17Input(input: PlannerInput): PlannerInput {
  const pinned = structuredClone(input)
  pinToSchema17(pinned.calculationContext)
  pinned.buildListEntries.forEach((entry) => {
    pinToSchema17(entry.calculationContext)
    pinToSchema17(entry.candidateSnapshot.calculationContext)
  })
  expect(pinned.conflictResolutions).toEqual([])
  return pinned
}

interface ParityCase {
  id: string
  input: PlannerInput
  dependencies: PlannerDependencies
  buildListContext?: PlannerRunBuildListContext
}

function parityCases(): ParityCase[] {
  // Only the inputs without explicit resolutions: an input with resolutions is
  // planned by the 9.6 semantics on purpose (the explicit-resolution scenario
  // of the catalogue is covered by `plannerOrdinaryConflictResolution.test.ts`).
  const catalogue = plannerSchedulerCatalogue()
    .filter(({ scenario }) => scenario.input.conflictResolutions.length === 0)
    .map((item): ParityCase => ({
      id: `catalogue:${item.id}`,
      input: item.scenario.input,
      dependencies: item.scenario.dependencies,
      buildListContext: item.buildListContext,
    }))
  const workloads = ['sanity-3', 'representative-12', 'representative-35'].map((id): ParityCase => {
    const fixture = createPlannerSchedulerWorkloadInput(id)
    return { id: `workload:${id}`, input: fixture.input, dependencies: createDeterministicPlannerDependencies(fixture.engine) }
  })
  return [...catalogue, ...workloads]
}

/**
 * The digest is taken over the result as calculation schema 17 recorded it:
 * the Issue #121 fields of the rejected Build List record (`targetWeaponId`,
 * `resourceConflictCause`, `docs/PLANNER_SPEC.md` 9.6.9.1) did not exist then
 * and are projected out, so the recorded digests stay the authority; the
 * fields are checked on their own (`expectRejectedRecordsCopyTheInput()`).
 */
async function plannerConflictResolutionParityDigest(item: ParityCase) {
  const result: PlannerResult = await createProductionPlanWithObserver(
    schema17Input(item.input),
    item.dependencies,
    undefined,
    undefined,
    item.buildListContext,
  )
  const projected = withoutIssue121RejectedRecordFields(result)
  const serialized = stableStringify(projected)
  return { hash: hashStableValue(projected), length: serialized.length, result }
}

describe('ordinary Planner parity for conflictResolutions = [] (schema 17 -> 18)', () => {
  it('covers the acceptance catalogue and the representative workloads', () => {
    expect(Object.keys(RECORDED_DIGESTS).sort()).toEqual(parityCases().map(({ id }) => id).sort())
  })

  it.each(parityCases().map(({ id }) => id))('plans %s exactly as calculation schema 17 did', async (id) => {
    const item = parityCases().find((candidate) => candidate.id === id)!
    const digest = await plannerConflictResolutionParityDigest(item)
    expect({ hash: digest.hash, length: digest.length }).toEqual(RECORDED_DIGESTS[id])
    expect('conflictResolutionOutcome' in digest.result).toBe(false)
    expectRejectedRecordsCopyTheInput(digest.result.plan?.rejectedBuildListEntries ?? [], item.input.buildListEntries)
  }, 120_000)
})
