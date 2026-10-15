import type { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeapon,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner'
import {
  runBuildListOptimization,
  type BuildListOptimizationArtifact,
} from '../../domain/planner/buildListOptimization'
import { BUILD_LIST_OPTIMIZATION_TEST_BOUNDS } from './buildListOptimizationWorkerFixtures'
import {
  createDeterministicPlannerDependencies,
  createPlannerSchedulerWorkloadInput,
} from './plannerSchedulerWorkloads'

/**
 * Real `optimized` artifacts of the Build List global optimization for the adoption save tests (Issue #260 PR-6A,
 * `docs/PLANNER_SPEC.md` 17.11): the artifact is calculated by `runBuildListOptimization()` from a Production-valid input, never
 * hand-built, so the save is tested against what the calculation really returns.
 *
 * The `scoped` input is the `sanity-3` scheduler workload (three planning Targets on owned Gogma sources) plus the out-of-scope
 * Targets and excluded Entries a real Build List holds:
 *
 * - `target.scope.stale-only` with only a stale Entry (`build_list_entry_stale`)
 * - `target.scope.completed`, completed, with its Entry (`completed_target_excluded`)
 * - `target.scope.no-entry` with no Entry
 *
 * and non-default improvement preferences: `bonus_first` on the bonus-only Entry (replaced by the optimization) and `skill_first` on
 * the skill-only Entry (kept unchanged). The optimization replaces the mixed-keep and the bonus-only Entries and keeps the skill-only
 * one. The `unchanged` input is the `scoped` Build List after that adoption: optimizing it again replaces nothing.
 */

export const BONUS_ONLY_TARGET_ID = 'target.issue103.bonus-only' as TargetWeaponId
export const SKILL_ONLY_TARGET_ID = 'target.issue103.skill-only' as TargetWeaponId
export const MIXED_KEEP_TARGET_ID = 'target.issue103.mixed-keep' as TargetWeaponId
export const STALE_ONLY_TARGET_ID = 'target.scope.stale-only' as TargetWeaponId
export const COMPLETED_TARGET_ID = 'target.scope.completed' as TargetWeaponId
export const NO_ENTRY_TARGET_ID = 'target.scope.no-entry' as TargetWeaponId
export const STALE_ENTRY_ID = 'build-list.scope.stale' as BuildListEntryId
export const COMPLETED_ENTRY_ID = 'build-list.scope.completed' as BuildListEntryId

export type BuildListOptimizationAdoptionVariant = 'scoped' | 'unchanged'

export interface BuildListOptimizationAdoptionFixture {
  /** The input the artifact was calculated from: exactly the persisted state the adoption expects. */
  input: PlannerInput
  engine: ProductionRngEngine
  artifact: BuildListOptimizationArtifact
}

function copyEntryFor(source: BuildListEntry, id: BuildListEntryId, target: TargetWeapon): BuildListEntry {
  return {
    ...structuredClone(source),
    id,
    targetWeaponId: target.id,
    candidateSnapshot: { ...structuredClone(source.candidateSnapshot), targetWeaponId: target.id },
  }
}

function scopedInput(): { input: PlannerInput; engine: ProductionRngEngine } {
  const { input, engine } = createPlannerSchedulerWorkloadInput('sanity-3')
  const skillOnly = input.targetWeapons.find(({ id }) => id === SKILL_ONLY_TARGET_ID) as TargetWeapon
  const skillEntry = input.buildListEntries.find(({ targetWeaponId }) => targetWeaponId === SKILL_ONLY_TARGET_ID) as BuildListEntry
  const staleOnly: TargetWeapon = { ...structuredClone(skillOnly), id: STALE_ONLY_TARGET_ID, preferredOwnedWeaponId: null }
  const completed: TargetWeapon = {
    ...structuredClone(skillOnly),
    id: COMPLETED_TARGET_ID,
    preferredOwnedWeaponId: null,
    lifecycleStatus: 'completed',
    completedAt: '2026-08-01T00:00:00.000Z',
    completedByProductionPlanId: null,
  }
  const noEntry: TargetWeapon = { ...structuredClone(skillOnly), id: NO_ENTRY_TARGET_ID, preferredOwnedWeaponId: null }
  // A Target definition hash no Target has: the Entry is stale against every current state.
  const staleEntry: BuildListEntry = { ...copyEntryFor(skillEntry, STALE_ENTRY_ID, staleOnly), targetDefinitionHash: 'fnv1a32:00000000' }
  const completedEntry = copyEntryFor(skillEntry, COMPLETED_ENTRY_ID, completed)
  const withPreference = (entry: BuildListEntry): BuildListEntry => {
    const preference = entry.targetWeaponId === BONUS_ONLY_TARGET_ID ? 'bonus_first'
      : entry.targetWeaponId === SKILL_ONLY_TARGET_ID ? 'skill_first' : null
    return preference === null ? entry : {
      ...entry,
      intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: preference },
    }
  }
  return {
    engine,
    input: {
      ...input,
      targetWeapons: [...input.targetWeapons, staleOnly, completed, noEntry],
      buildListEntries: [...input.buildListEntries.map(withPreference), staleEntry, completedEntry],
    },
  }
}

async function optimize(input: PlannerInput, engine: ProductionRngEngine): Promise<BuildListOptimizationArtifact> {
  const run = await runBuildListOptimization(
    structuredClone(input),
    createDeterministicPlannerDependencies(engine),
    structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS),
  )
  if (run.kind !== 'result' || run.result.status !== 'optimized') {
    throw new Error(`The adoption fixture input was not optimized: ${JSON.stringify(run).slice(0, 2_000)}`)
  }
  return run.result.artifact
}

/** The Build List after adopting `artifact`: each replaced Entry removed and each generated Entry added. */
export function replacedBuildList(input: PlannerInput, artifact: BuildListOptimizationArtifact): BuildListEntry[] {
  const replaced = new Set<string>(artifact.replacements.map(({ replacedBuildListEntryId }) => replacedBuildListEntryId))
  return [
    ...input.buildListEntries.filter(({ id }) => !replaced.has(id)),
    ...artifact.generatedBuildListEntries,
  ].map((entry) => structuredClone(entry))
}

export async function createBuildListOptimizationAdoptionFixture(
  variant: BuildListOptimizationAdoptionVariant = 'scoped',
): Promise<BuildListOptimizationAdoptionFixture> {
  const { input, engine } = scopedInput()
  const artifact = await optimize(input, engine)
  if (variant === 'scoped') return { input, engine, artifact }
  const adopted: PlannerInput = { ...input, buildListEntries: replacedBuildList(input, artifact) }
  return { input: adopted, engine, artifact: await optimize(adopted, engine) }
}
