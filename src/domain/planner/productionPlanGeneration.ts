import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  ExpectedPlanState,
  MaterialRequirement,
  PlanStep,
  PlanStepOperationType,
  PlanningInputSnapshot,
  ProductionPlan,
  RejectedBuildListEntry,
  TargetWeapon,
} from '../models/publicTypes'
import {
  createExpectedPlanState,
  hashStableValue,
  stableStringify,
} from '../models/publicTypes'
import { createTargetDefinitionHash } from '../buildList'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import {
  replayPlannerSearchTrace,
  type PlannerPlanStepDraft,
  type PlannerTraceReplayResult,
  type PlannerTraceReplayIssue,
} from './plannerTraceReplay'
import type {
  CreateProductionPlanCalculation,
  PlannerBeamSearchResult,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerResult,
  PlannerSearchRejection,
  PlannerWarning,
  ProductionPlanGenerationObserver,
} from './plannerTypes'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameExpectedPlanState(
  left: ExpectedPlanState,
  right: ExpectedPlanState,
): boolean {
  return stableStringify(left) === stableStringify(right)
}

function normalizeCandidateBonuses(candidate: BuildCandidate) {
  return candidate.finalBonuses
    .map(({ bonusTypeId, bonusRankId }) => ({ bonusTypeId, bonusRankId }))
    .sort((left, right) => {
      const type = compareStableStrings(left.bonusTypeId, right.bonusTypeId)
      return type !== 0
        ? type
        : compareStableStrings(left.bonusRankId, right.bonusRankId)
    })
}

function normalizeCandidateMaterials(candidate: BuildCandidate) {
  return candidate.requiredMaterials
    .map(({ materialId, quantity }) => ({ materialId, quantity }))
    .sort((left, right) => {
      const material = compareStableStrings(left.materialId, right.materialId)
      return material !== 0 ? material : left.quantity - right.quantity
    })
}

function normalizeCandidateSnapshot(candidate: BuildCandidate) {
  return {
    targetWeaponId: candidate.targetWeaponId,
    category: candidate.category,
    finalBonuses: normalizeCandidateBonuses(candidate),
    restorationBonusScope: candidate.restorationBonusScope,
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    route: candidate.route,
    estimatedOperationCount: candidate.estimatedOperationCount,
    estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
    estimatedSkillAdvance: candidate.estimatedSkillAdvance,
    estimatedNormalAdvance: candidate.estimatedNormalAdvance,
    requiredMaterials: normalizeCandidateMaterials(candidate),
    searchStateHash: candidate.searchStateHash,
    referencedOwnedWeaponsHash: candidate.referencedOwnedWeaponsHash,
    calculationContext: candidate.calculationContext,
  }
}

/** Stable semantic fingerprint for the targets on which a Plan was calculated. */
export function createPlanningTargetWeaponsHash(
  targetWeapons: readonly TargetWeapon[],
): string {
  return hashStableValue(
    targetWeapons
      .map((target) => ({
        id: target.id,
        definitionHash: createTargetDefinitionHash(target),
      }))
      .sort((left, right) => compareStableStrings(left.id, right.id)),
  )
}

/**
 * Stable semantic fingerprint of BuildList inputs. Persisted stale flags and
 * timestamps are deliberately excluded because Planner revalidates them.
 */
export function createPlanningBuildListEntriesHash(
  entries: readonly BuildListEntry[],
): string {
  return hashStableValue(
    entries
      .map((entry) => ({
        id: entry.id,
        candidateSnapshot: normalizeCandidateSnapshot(entry.candidateSnapshot),
        targetDefinitionHash: entry.targetDefinitionHash,
        searchStateHash: entry.searchStateHash,
        referencedOwnedWeaponsHash: entry.referencedOwnedWeaponsHash,
        calculationContext: entry.calculationContext,
      }))
      .sort((left, right) => compareStableStrings(left.id, right.id)),
  )
}

export function createPlanningInputSnapshot(
  input: PlannerInput,
  createdAt: PlanningInputSnapshot['createdAt'],
): PlanningInputSnapshot {
  return {
    initialExecutionState: createExpectedPlanState(
      input.rngState,
      input.normalCounters,
      input.ownedWeapons,
    ),
    targetWeaponsHash: createPlanningTargetWeaponsHash(input.targetWeapons),
    buildListEntriesHash: createPlanningBuildListEntriesHash(input.buildListEntries),
    calculationContext: structuredClone(input.calculationContext),
    createdAt,
  }
}

const operationPresentation: Record<
  PlanStepOperationType,
  { title: string; instruction: string }
> = {
  create_normal_artian: {
    title: '通常アーティアを作成',
    instruction: '対象の通常アーティアを1回作成し、結果を確認してください。',
  },
  convert_normal_to_gogma: {
    title: '巨戟アーティアへ変換',
    instruction: '対象の通常アーティアを巨戟アーティアへ変換し、結果を確認してください。',
  },
  reset_bonuses: {
    title: '復元ボーナスを再抽選',
    instruction: '復元ボーナスを再抽選し、結果を確認してください。',
  },
  keep_bonuses: {
    title: '復元ボーナスを保持して再抽選',
    instruction: '指定された復元ボーナスを保持して再抽選し、結果を確認してください。',
  },
  reset_skills: {
    title: 'スキルを再付与',
    instruction: 'スキルを再付与し、結果を確認してください。',
  },
  use_weapon_as_material: {
    title: '素材用武器を使用',
    instruction: '指定された素材用武器を使用し、結果を確認してください。',
  },
  reserve_weapon: {
    title: '候補武器を確保',
    instruction: '候補武器を確保し、結果を確認してください。',
  },
  create_material_gogma: {
    title: '素材用巨戟アーティアを登録',
    instruction: '作成済みの巨戟アーティアを素材用武器として登録し、結果を確認してください。',
  },
  change_owned_weapon_status: {
    title: '所持武器の状態を変更',
    instruction: '所持武器の状態変更を確認してください。',
  },
  confirm_result: {
    title: '結果を確認',
    instruction: '操作結果を確認してください。',
  },
}

/** Pure deterministic presentation text; no game UI labels or navigation are assumed. */
export function createPlanStepPresentation(
  operationType: PlanStepOperationType,
  target: TargetWeapon | null,
): Pick<PlanStep, 'title' | 'instruction'> {
  const base = operationPresentation[operationType]
  const targetSuffix = target === null ? '' : ` 「${target.name}」用`
  return {
    title: `${base.title}${targetSuffix}`,
    instruction: base.instruction,
  }
}

export class PlannerPlanGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlannerPlanGenerationError'
  }
}

function replayErrorMessage(issues: readonly PlannerTraceReplayIssue[]): string {
  return issues
    .map(({ code, message, actionIndex }) =>
      `[${code}] actionIndex=${actionIndex ?? 'null'}: ${message}`)
    .join('; ')
}

export function createPlanStepsFromDrafts(
  drafts: readonly PlannerPlanStepDraft[],
  input: PlannerInput,
  dependencies: PlannerDependencies,
  initialExecutionState: ExpectedPlanState,
): PlanStep[] {
  const targetsById = new Map(input.targetWeapons.map((target) => [target.id, target]))
  const steps = drafts.map((draft, index) => {
    const target = draft.targetWeaponId === null
      ? null
      : targetsById.get(draft.targetWeaponId) ?? null
    const presentation = createPlanStepPresentation(draft.operationType, target)
    return {
      id: dependencies.idFactory.planStepId(),
      order: index + 1,
      operationType: draft.operationType,
      ...presentation,
      targetWeaponId: draft.targetWeaponId,
      buildListEntryId: draft.primaryBuildListEntryId,
      candidateId: draft.candidateId,
      ownedWeaponId: draft.ownedWeaponId,
      expectedResult: structuredClone(draft.expectedResult),
      expectedStateBefore: structuredClone(draft.expectedStateBefore),
      expectedStateAfter: structuredClone(draft.expectedStateAfter),
      inventoryChange: structuredClone(draft.inventoryChange),
      rngAdvance: structuredClone(draft.rngAdvance),
      requiresUserConfirmation: true,
      isCompleted: false,
      completedAt: null,
      debug: structuredClone(draft.debug),
    } satisfies PlanStep
  })

  if (
    steps.length > 0 &&
    !sameExpectedPlanState(steps[0].expectedStateBefore, initialExecutionState)
  ) {
    throw new PlannerPlanGenerationError(
      'The first PlanStep expectedStateBefore differs from PlanningInputSnapshot.initialExecutionState.',
    )
  }
  for (let index = 0; index + 1 < steps.length; index += 1) {
    if (!sameExpectedPlanState(
      steps[index].expectedStateAfter,
      steps[index + 1].expectedStateBefore,
    )) {
      throw new PlannerPlanGenerationError(
        `PlanStep expected-state chain is broken between orders ${steps[index].order} and ${steps[index + 1].order}.`,
      )
    }
  }
  return steps
}

function rejectedReason(
  entry: BuildListEntry,
  selectedEntryIds: ReadonlySet<BuildListEntryId>,
  input: PlannerInput,
  beamResult: PlannerBeamSearchResult,
): RejectedBuildListEntry['reason'] {
  const rejections = beamResult.rejections.filter(
    (rejection) => rejection.buildListEntryId === entry.id,
  )
  if (rejections.some(({ reason }) => reason === 'protected_destructive_use')) {
    return 'requires_protected_weapon'
  }
  if (beamResult.conflicts.some((conflict) =>
    conflict.buildListEntryIds.includes(entry.id) &&
    conflict.selectedBuildListEntryId !== null &&
    conflict.selectedBuildListEntryId !== entry.id &&
    selectedEntryIds.has(conflict.selectedBuildListEntryId),
  )) {
    return 'resource_conflict'
  }
  if (rejections.some(({ reason }) => reason === 'candidate_already_satisfied')) {
    return 'already_satisfied'
  }
  const selectedComparable = input.buildListEntries.some((selected) =>
    selectedEntryIds.has(selected.id) &&
    selected.targetWeaponId === entry.targetWeaponId &&
    selected.candidateSnapshot.category === entry.candidateSnapshot.category &&
    selected.candidateSnapshot.estimatedOperationCount <
      entry.candidateSnapshot.estimatedOperationCount,
  )
  return selectedComparable ? 'longer_route' : 'dominated_by_better_candidate'
}

function hasOnlyNonSearchRejections(rejections: readonly PlannerSearchRejection[]): boolean {
  return rejections.length > 0 && rejections.every(({ reason }) =>
    reason === 'rng_contract_unavailable' ||
    reason === 'counter_after_mismatch' ||
    reason === 'counter_unavailable',
  )
}

export function createRejectedBuildListEntries(
  input: PlannerInput,
  beamResult: PlannerBeamSearchResult,
  selectedBuildListEntryIds: readonly BuildListEntryId[],
): RejectedBuildListEntry[] {
  const selected = new Set(selectedBuildListEntryIds)
  const excludedIds = new Set(beamResult.excludedBuildListEntries.map(({ entry }) => entry.id))
  const rejectionsByEntryId = new Map<BuildListEntryId, PlannerSearchRejection[]>()
  beamResult.rejections.forEach((rejection) => {
    const entries = rejectionsByEntryId.get(rejection.buildListEntryId) ?? []
    entries.push(rejection)
    rejectionsByEntryId.set(rejection.buildListEntryId, entries)
  })
  const traceEntryIds = new Set<BuildListEntryId>(
    beamResult.bestState?.trace.flatMap((action) => [
      action.primaryBuildListEntryId,
      ...action.progressedBuildListEntryIds,
    ]) ?? [],
  )
  const baseRejectedEntries = input.buildListEntries
    .filter((entry) => !selected.has(entry.id))
    .filter((entry) => {
      const rejections = rejectionsByEntryId.get(entry.id) ?? []
      return !excludedIds.has(entry.id) || rejections.some(
        ({ reason }) => reason === 'protected_destructive_use',
      )
    })
    .filter((entry) => !hasOnlyNonSearchRejections(rejectionsByEntryId.get(entry.id) ?? []))

  if (!beamResult.completed) {
    return baseRejectedEntries
      .filter((entry) => !traceEntryIds.has(entry.id))
      .map((entry) => ({
        entry,
        reason: rejectedReason(entry, selected, input, beamResult),
      }))
      .filter(({ reason }) =>
        reason === 'requires_protected_weapon' || reason === 'resource_conflict',
      )
      .map(({ entry, reason }) => ({
        buildListEntryId: entry.id,
        reason,
        detail: 'Beam Searchの途中結果で、このBuildListEntryは実行不能と確定しました。',
      }))
      .sort((left, right) => compareStableStrings(left.buildListEntryId, right.buildListEntryId))
  }

  return baseRejectedEntries
    .map((entry) => ({
      buildListEntryId: entry.id,
      reason: rejectedReason(entry, selected, input, beamResult),
      detail: 'Beam Searchの最終StateでこのBuildListEntryは採用されませんでした。',
    }))
    .sort((left, right) => compareStableStrings(left.buildListEntryId, right.buildListEntryId))
}

export function collectRequiredMaterials(
  input: PlannerInput,
  selectedBuildListEntryIds: readonly BuildListEntryId[],
): MaterialRequirement[] {
  const selected = new Set(selectedBuildListEntryIds)
  const quantities = new Map<string, number>()
  input.buildListEntries.forEach((entry) => {
    if (!selected.has(entry.id)) return
    entry.candidateSnapshot.requiredMaterials.forEach(({ materialId, quantity }) => {
      quantities.set(materialId, (quantities.get(materialId) ?? 0) + quantity)
    })
  })
  return [...quantities]
    .filter(([, quantity]) => quantity >= 1)
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([materialId, quantity]) => ({
      materialId: materialId as MaterialRequirement['materialId'],
      quantity,
    }))
}

/**
 * Shared Production Plan generation with an optional runtime observer
 * (PLANNER_SPEC 9.2.16).
 *
 * This is the single implementation. Ordinary `createProductionPlan()`
 * delegates here without an observer, and B8 constrained-search orchestration
 * delegates here with one, so the two paths can never drift apart.
 *
 * `observer.beforeBeamSearch()` is called once immediately before each full
 * `runPlannerBeamSearch()` execution that actually starts: the first one, and
 * every runtime-unsupported retry, and the optional
 * `observer.afterBeamSearch()` once immediately after each of them returns.
 * The observer is semantics-neutral, so nothing below branches on its presence,
 * and an exception it throws propagates unchanged instead of becoming a
 * `PlannerResult`.
 */
export async function createProductionPlanWithObserver(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options: PlannerExecutionOptions | undefined,
  observer?: ProductionPlanGenerationObserver,
): Promise<PlannerResult> {
  const runtimeUnsupported = new Map<BuildListEntryId, string>()
  let beamResult: PlannerBeamSearchResult | null = null
  let replay: PlannerTraceReplayResult | null = null

  for (;;) {
    const beamInput: PlannerInput = runtimeUnsupported.size === 0
      ? input
      : {
          ...input,
          buildListEntries: input.buildListEntries.filter(
            ({ id }) => !runtimeUnsupported.has(id),
          ),
        }
    observer?.beforeBeamSearch()
    beamResult = await runPlannerBeamSearch(beamInput, dependencies, options)
    observer?.afterBeamSearch?.(beamResult)
    if (
      beamResult.cancelled ||
      beamResult.bestState === null ||
      beamResult.bestState.trace.length === 0
    ) break

    replay = replayPlannerSearchTrace(
      beamInput,
      beamResult.bestState,
      dependencies.rngEngine,
    )
    if (replay.unsupportedInput === null) break

    const unsupported = replay.unsupportedInput
    if (runtimeUnsupported.has(unsupported.buildListEntryId)) {
      throw new PlannerPlanGenerationError(
        `Planner repeatedly selected unsupported BuildListEntry '${unsupported.buildListEntryId}'.`,
      )
    }
    runtimeUnsupported.set(
      unsupported.buildListEntryId,
      `requires unsupported RNG input (${unsupported.operationType}: ${unsupported.reason}).`,
    )
    replay = null
  }

  if (beamResult === null) {
    throw new PlannerPlanGenerationError('Planner Beam Search did not return a result.')
  }
  const runtimeWarnings: PlannerWarning[] = [...runtimeUnsupported]
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([entryId, reason]) => ({
      kind: 'rng_prediction_unsupported',
      message: `BuildListEntry '${entryId}' ${reason}`,
    }))
  if (runtimeUnsupported.size > 0) {
    const alreadyExcluded = new Set(
      beamResult.excludedBuildListEntries.map(({ entry }) => entry.id),
    )
    input.buildListEntries.forEach((entry) => {
      const reason = runtimeUnsupported.get(entry.id)
      if (reason && !alreadyExcluded.has(entry.id)) {
        beamResult?.excludedBuildListEntries.push({ entry, reason })
      }
    })
  }
  const warnings = [...beamResult.warnings, ...runtimeWarnings]
    .filter((warning, index, all) =>
      all.findIndex((candidate) =>
        candidate.kind === warning.kind &&
        candidate.message === warning.message,
      ) === index,
    )
  if (
    beamResult.cancelled ||
    beamResult.bestState === null ||
    beamResult.bestState.trace.length === 0
  ) {
    return {
      plan: null,
      conflicts: structuredClone(beamResult.conflicts),
      warnings: structuredClone(warnings),
    }
  }
  if (replay === null || !replay.isValid) {
    throw new PlannerPlanGenerationError(
      `Planner trace replay failed: ${replayErrorMessage(replay?.issues ?? [])}`,
    )
  }

  const now = dependencies.clock.now()
  const baseSnapshot = createPlanningInputSnapshot(input, now)
  const productionPlanId = dependencies.idFactory.productionPlanId()
  const steps = createPlanStepsFromDrafts(
    replay.drafts,
    input,
    dependencies,
    baseSnapshot.initialExecutionState,
  )
  const selectedBuildListEntryIds = [...new Set(beamResult.bestState.selectedBuildListEntryIds)]
    .sort(compareStableStrings)
  const plan: ProductionPlan = {
    id: productionPlanId,
    status: 'draft',
    baseSnapshot,
    selectedBuildListEntryIds,
    calculationContext: structuredClone(input.calculationContext),
    steps,
    conflicts: structuredClone(beamResult.conflicts),
    rejectedBuildListEntries: createRejectedBuildListEntries(
      input,
      beamResult,
      selectedBuildListEntryIds,
    ),
    requiredMaterials: collectRequiredMaterials(input, selectedBuildListEntryIds),
    currentStepId: steps[0]?.id ?? null,
    recalculationReasons: [],
    createdAt: now,
    updatedAt: now,
  }
  return {
    plan,
    conflicts: structuredClone(beamResult.conflicts),
    warnings: structuredClone(warnings),
  }
}

/**
 * The ordinary Production Plan calculation. Its signature and result semantics
 * are unchanged; it simply runs the shared implementation with no observer.
 */
export const createProductionPlan: CreateProductionPlanCalculation = async (
  input,
  dependencies,
  options: PlannerExecutionOptions | undefined,
) => createProductionPlanWithObserver(input, dependencies, options)
